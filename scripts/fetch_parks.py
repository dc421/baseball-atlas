"""Fetch a Wikipedia photo and a dimensions diagram for every franchise's home park into docs/parks/,
with credits and the outfield distances in docs/data/parks.json.

Run from the repo root, after build_data.py:
    python scripts/fetch_parks.py            # only parks not looked up yet
    python scripts/fetch_parks.py --refresh  # redo everything
    python scripts/fetch_parks.py --only NYC16 BOS07

The diagram is the article's dimensions drawing (e.g. FenwayParkDimensions.svg) or, failing that, another
field diagram or plan in it. Parks with neither still get the infobox's distances, which the site draws as a field.
Wrong park or picture? Add a row to data/overrides/park_titles.csv (key = the park key in data/park_review.csv,
title = the exact Wikipedia article title or NONE, photo / diagram = a File name to use instead, optional),
then rerun with --only <key>. Check data/park_review.csv after a run.
"""
import argparse, csv, html, io, json, re, sys, time
from pathlib import Path
from PIL import Image
from fetch_photos import S, api, fold, strip_html

ROOT = Path(__file__).resolve().parent.parent
ATLAS = ROOT / 'docs' / 'data' / 'atlas.json'
MANIFEST = ROOT / 'docs' / 'data' / 'parks.json'
PARKS = ROOT / 'docs' / 'parks'
OVERRIDES = ROOT / 'data' / 'overrides' / 'park_titles.csv'
REVIEW = ROOT / 'data' / 'park_review.csv'
VENUE = re.compile(r'stadium|ballpark|park|field|grounds|venue|dome|coliseum|oval|arena', re.I)
GENERIC = {'park', 'field', 'grounds', 'stadium', 'ballpark', 'oval', 'the', 'base', 'ball', 'new', 'old'}
NOT_PHOTO = re.compile(r'logo|map|locator|location|relief|flag|seal|icon|dimension|diagram|sanborn|plan|wordmark|commons-|edit', re.I)
DIAGRAM = re.compile(r'dimension|diagram|layout|schematic|sanborn|plan\b|plan[_ .]', re.I)


def candidates(p):
    """Article titles to try, best first: the park's names, then a search."""
    names = [p['n']] + [a.strip() for a in (p['al'] or '').split(';') if a.strip()]
    names += [re.sub(r'\s+(I{1,3}|IV|V|VI)$', '', n) for n in names]  # "Polo Grounds IV" -> "Polo Grounds"
    res = api(action='query', list='search', srsearch=f"{p['n']} {p['c']} baseball", srlimit=5)
    return list(dict.fromkeys(names + [h['title'] for h in res['query']['search']]))


def shares_name(p, title):
    """The article title has a distinctive word of one of the park's names (Lenox Oval is not the Polo Grounds)."""
    stem = lambda s: {w.rstrip('s') for w in re.findall(r'[a-z]{3,}', fold(s))}
    words = {w for n in [p['n']] + (p['al'] or '').split(';') for w in stem(n)} - GENERIC
    return not words or bool(words & stem(title))


def find_article(p):
    cands, own = candidates(p), {fold(n.strip()) for n in [p['n']] + (p['al'] or '').split(';')}
    q = api(action='query', titles='|'.join(cands[:20]), redirects=1, prop='description|extracts|pageprops',
            exintro=1, explaintext=1, exlimit=20, exchars=1200)
    pages = {x['title']: x for x in q['query']['pages']}
    redir = {r['from']: r['to'] for r in q['query'].get('redirects', []) + q['query'].get('normalized', [])}
    city = fold(p['c'] or '')
    for c in cands:
        t = redir.get(c, c); t = redir.get(t, t)
        x = pages.get(t)
        if not x or x.get('missing') or 'disambiguation' in x.get('pageprops', {}) or x['title'].startswith('List of'):
            continue
        text = fold(' '.join([x['title'], x.get('description', ''), x.get('extract', '')]))
        if not VENUE.search(x['title'] + ' ' + x.get('description', '')) or re.search(r'\bseason\b|team|club|player', x.get('description', ''), re.I):
            continue
        if fold(c) not in own and not shares_name(p, x['title']):  # its own name may redirect (AT&T Park -> Oracle Park)
            continue
        if city and city not in text:
            continue
        return x['title']
    return None


def file_info(fname, width):
    q = api(action='query', titles='File:' + fname, prop='imageinfo', iiprop='url|extmetadata', iiurlwidth=width)
    ii = (q['query']['pages'][0].get('imageinfo') or [None])[0]
    if not ii: return None
    meta = ii.get('extmetadata', {})
    return dict(url=ii.get('thumburl') or ii['url'], source=fname,
                credit=strip_html(meta.get('Artist', {}).get('value', ''))[:120] or 'Wikimedia Commons',
                license=strip_html(meta.get('LicenseShortName', {}).get('value', '')))


def field_size(wikitext):
    """The infobox's outfield distances: [[label, feet], ...], the last configuration listed."""
    m = re.search(r'\|\s*(?:field[ _]?size|dimensions)\s*=(.*?)(?=\n\s*\|\s*[a-z_ ]+=|\n\}\})', wikitext, re.S | re.I)
    if not m: return []
    s = re.sub(r'<ref[^>]*/>|<ref.*?</ref>', '', m.group(1), flags=re.S)
    s = re.sub(r'\[\[File:[^\]]*\]\]', '', s)
    s = re.sub(r'\{\{\s*convert\s*\|\s*(\d+)\s*\|\s*ft[^}]*\}\}', r'\1 ft', s, flags=re.I)
    s = html.unescape(re.sub(r"'''?|\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r'\1', s)).replace('\xa0', ' ')
    out, seen = [], set()
    for seg in re.split(r'<br\s*/?>|\n|\|', s):
        seg = re.sub(r'<[^>]+>|\{\{[^}]*\}\}', '', seg)
        m = re.search(r'([A-Za-z][A-Za-z .\-–]*?)\s*[:–—\-]?\s*(\d{3})\s*(?:ft|feet|\')', seg)
        if not m: continue
        label = re.sub(r'\s+', ' ', m.group(1)).strip(' -–.').capitalize()
        if fold(label) in seen: out, seen = [], set()  # a later configuration starts: keep the last
        seen.add(fold(label)); out.append([label, int(m.group(2))])
    return out


def pick_images(title, ov):
    page = api(action='parse', page=title, prop='wikitext|images', redirects=1)['parse']
    imgs = [i.replace(' ', '_') for i in page['images']]
    lead = api(action='query', titles=title, redirects=1, prop='pageimages', piprop='name')['query']['pages'][0].get('pageimage')
    photo = ov.get('photo') or next((f for f in ([lead] if lead else []) + imgs
                                     if not NOT_PHOTO.search(f) and re.search(r'\.(jpe?g|png|tiff?)$', f, re.I)), None)
    dims = sorted((f for f in imgs if DIAGRAM.search(f)), key=lambda f: (not re.search(r'dimensions\.svg$', f, re.I), not f.lower().endswith('.svg')))
    diagram = ov.get('diagram') or (dims[0] if dims else None)
    return page['title'], photo, diagram, field_size(page['wikitext'])


def save(info, out_stem, photo=False):
    r = S.get(info['url'], timeout=60); r.raise_for_status()
    if photo:  # photos as modest JPEGs (some come as multi-megabyte PNGs); diagrams as they are
        out = PARKS / f'{out_stem}.jpg'
        im = Image.open(io.BytesIO(r.content)).convert('RGB'); im.thumbnail((800, 800))
        im.save(out, 'JPEG', quality=80, optimize=True)
    else:
        out = PARKS / f"{out_stem}{Path(info['url'].split('?')[0]).suffix.lower() or '.png'}"
        out.write_bytes(r.content)
    return dict(file=out.name, source=info['source'], credit=info['credit'], license=info['license'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--only', nargs='*')
    args = ap.parse_args()
    D = json.loads(ATLAS.read_text())
    used = {pk for f in D['franch'].values() for pk, _ in f.get('pk', [])}
    parks = {k: p for k, p in D['parks'].items() if k in used}
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    overrides = {}
    if OVERRIDES.exists():
        with OVERRIDES.open() as f:
            overrides = {r['key']: {k: v for k, v in r.items() if v} for r in csv.DictReader(f)}
    PARKS.mkdir(parents=True, exist_ok=True)
    todo = [k for k in parks if (args.only and k in args.only) or (not args.only and (args.refresh or k not in manifest))]
    print(f'{len(todo)} parks to look up')
    for i, k in enumerate(todo, 1):
        p, ov = parks[k], overrides.get(k, {})
        try:
            for old in PARKS.glob(f'{k}.*'): old.unlink()
            for old in PARKS.glob(f'{k}_dim.*'): old.unlink()
            title = ov.get('title') or find_article(p)
            if not title or title == 'NONE':
                manifest[k] = dict(page=None)
                print(f'[{i}/{len(todo)}] {k} {p["n"]}: no article'); continue
            title, photo, diagram, dims = pick_images(title, ov)
            m = dict(page=title)
            if photo and (info := file_info(photo, 800)): m['photo'] = save(info, k, photo=True)
            if diagram and (info := file_info(diagram, 600)): m['diagram'] = save(info, k + '_dim')
            if dims: m['dims'] = dims
            manifest[k] = m
            print(f'[{i}/{len(todo)}] {k} {p["n"]}: {title} | photo {photo} | diagram {diagram} | {len(dims)} distances')
        except Exception as e:  # keep going; one bad lookup shouldn't stop the run
            print(f'[{i}/{len(todo)}] {k} {p["n"]}: error {e}', file=sys.stderr)
        time.sleep(0.3)
        if i % 25 == 0:
            MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    with REVIEW.open('w', newline='') as f:
        w = csv.writer(f); w.writerow(['key', 'park', 'city', 'years', 'wikipedia_article', 'photo', 'diagram', 'distances'])
        w.writerows([k, parks[k]['n'], parks[k]['c'], f"{parks[k]['y0']}-{parks[k]['y1']}", m.get('page') or '',
                     m.get('photo', {}).get('source', ''), m.get('diagram', {}).get('source', ''),
                     ' '.join(f'{a} {b}' for a, b in m.get('dims', []))] for k, m in sorted(manifest.items()) if k in parks)
    print(f"done: {sum(1 for m in manifest.values() if m.get('photo'))} photos, {sum(1 for m in manifest.values() if m.get('diagram'))} diagrams "
          f"of {len(parks)} parks. Review matches in {REVIEW.relative_to(ROOT)}")


if __name__ == '__main__':
    main()
