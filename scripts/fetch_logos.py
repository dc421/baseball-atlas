"""Fetch one Wikipedia logo per franchise name (e.g. Brooklyn Dodgers, Los Angeles Dodgers) into docs/logos/.

Run from the repo root, after build_data.py, then rerun build_data.py so the site sees the files:
    python scripts/fetch_logos.py            # only names without a logo yet
    python scripts/fetch_logos.py --refresh  # redo everything
    python scripts/fetch_logos.py --only LAD BRO

Files are named <franchise>_<first year of that name>.png, so docs/logos/README.md's rules pick them up.
Wrong logo? Add a row to data/overrides/logo_titles.csv
(key = <franchise>_<year>, title = the exact Wikipedia article title, or File:<name> for a specific image,
or NONE to keep the colored badge), then rerun with --only <franchise>.
Check data/logo_review.csv after a run.
"""
import argparse, csv, json, re, sys, time
from pathlib import Path
from fetch_photos import S, api, fold

ROOT = Path(__file__).resolve().parent.parent
ATLAS = ROOT / 'docs' / 'data' / 'atlas.json'
LOGOS = ROOT / 'docs' / 'logos'
OVERRIDES = ROOT / 'data' / 'overrides' / 'logo_titles.csv'
REVIEW = ROOT / 'data' / 'logo_review.csv'
LOGOISH = re.compile(r'logo|(?<![a-z])cap(?![a-z])|insignia|emblem|wordmark|patch', re.I)  # not "Captain"
NOT_TEAM = re.compile(r'league|mlb-logo|commons|wiki|flag|question|edit|stadium|park|field|access|lock|icon|history|pcl', re.I)
COMMONS = 'https://commons.wikimedia.org/w/api.php'
YEAR = r'(1[89]\d\d|20\d\d)'


def eras(teams):
    """Unbroken runs of one name within a franchise: list of dicts with fr, name, first, last, lg."""
    out, cur = [], {}
    for t in sorted(teams.values(), key=lambda t: (t['fr'], t['y'])):
        e = cur.get(t['fr'])
        if e and e['name'] == t['n'] and t['y'] <= e['last'] + 1:
            e['last'] = t['y']; continue
        cur[t['fr']] = e = dict(fr=t['fr'], name=t['n'], first=t['y'], last=t['y'], lg=t['lg'])
        out.append(e)
    return out


def overlaps(text, first, last):
    """None if text names no years; else whether its year span overlaps first..last."""
    yrs = [int(y) for y in re.findall(YEAR, text)]
    if re.search(r'present', text, re.I):
        yrs.append(2100)
    if not yrs:
        return None
    if len(yrs) == 1:  # "Logo (1901)" or "logo 1977-" style: treat as from that year on
        return yrs[0] <= last
    return min(yrs) <= last and max(yrs) >= first


def find_article(e, latest):
    """Wikipedia article for this team name. `latest` = no other franchise used the name later."""
    name, first, last = e['name'], e['first'], e['last']
    res = api(action='query', list='search', srsearch=f'{name} baseball team {first}', srlimit=5)
    cands = list(dict.fromkeys([name] + [h['title'] for h in res['query']['search']]))
    q = api(action='query', titles='|'.join(cands), prop='description', redirects=1)
    pages = {p['title']: p for p in q['query']['pages']}
    redir = {r['from']: r['to'] for r in q['query'].get('redirects', [])}
    for c in cands:
        p = pages.get(redir.get(c, c))
        d = (p or {}).get('description', '').lower()
        if not p or p.get('missing') or 'baseball' not in d or not re.search(r'team|club|franchise', d) or 'season' in d:
            continue
        ok = overlaps(p['title'] + ' ' + d, first, last)
        # a shared name's undated article is the modern team's (keeps today's Orioles off the 1880s Orioles)
        if ok is False or (ok is None and not latest):
            continue
        return p['title']
    return None


def logo_image(title, e, current):
    q = api(action='query', titles=title, redirects=1, prop='pageimages|images', piprop='thumbnail|name',
            pithumbsize=128, pilicense='any', imlimit=100)
    page = q['query']['pages'][0]
    first, last = e['first'], e['last']
    lead = page.get('pageimage')
    cands = [lead] if lead and lead.lower().endswith('.svg') else []
    cands += [im['title'].split(':', 1)[1] for im in page.get('images', [])]
    cands = [f for f in dict.fromkeys(cands) if (f == lead or LOGOISH.search(f)) and not NOT_TEAM.search(f)]
    dated = [f for f in cands if overlaps(f, first, last)]
    # an undated logo is today's, unless the article is about exactly this name (Superbas -> Brooklyn Dodgers is not)
    own = re.sub(r' \(.*\)$', '', page['title']) == e['name']
    undated = [f for f in cands if overlaps(f, first, last) is None] if current or own else []
    # today's team wants today's logo; an old name wants a logo dated to its years
    for f in (undated + dated if current else dated + undated):
        th = page['thumbnail']['source'] if f == lead else file_thumb(f)
        if th:
            return f, th, page['title']
    return None


def file_thumb(fname, endpoint=None):
    params = dict(action='query', titles='File:' + fname, prop='imageinfo', iiprop='url', iiurlwidth=128)
    q = api(**params) if not endpoint else S.get(endpoint, params=dict(params, format='json', formatversion=2), timeout=30).json()
    ii = q['query']['pages'][0].get('imageinfo')
    return ii[0].get('thumburl') if ii else None


def search_files(e):
    """Fallback: a logo file named for this team (city and nickname in the file name), on Wikipedia or Commons."""
    city, nick = fold(e['name'].split()[0]), fold(e['name'].split()[-1])
    for endpoint in (None, COMMONS):
        params = dict(action='query', list='search', srsearch=f"{e['name']} logo", srnamespace=6, srlimit=10)
        q = api(**params) if not endpoint else S.get(endpoint, params=dict(params, format='json', formatversion=2), timeout=30).json()
        for h in q['query']['search']:
            f = h['title'].split(':', 1)[1]
            if nick in fold(f) and city in fold(f) and LOGOISH.search(f) and not NOT_TEAM.search(f) and overlaps(f, e['first'], e['last']) is not False:
                th = file_thumb(f, endpoint)
                if th:
                    return f, th, ('Commons' if endpoint else 'Wikipedia') + ' file search'
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--only', nargs='*')
    args = ap.parse_args()
    all_eras = eras(json.loads(ATLAS.read_text())['teams'])
    last_use, fr_last, now = {}, {}, max(e['last'] for e in all_eras)
    for e in all_eras:
        last_use[e['name']] = max(last_use.get(e['name'], 0), e['last'])
        fr_last[e['fr']] = max(fr_last.get(e['fr'], 0), e['last'])
    overrides = {}
    if OVERRIDES.exists():
        with OVERRIDES.open() as f:
            overrides = {r['key']: r['title'] for r in csv.DictReader(f)}
    review = {}
    if REVIEW.exists():
        with REVIEW.open() as f:
            review = {r['key']: r for r in csv.DictReader(f)}
    LOGOS.mkdir(parents=True, exist_ok=True)
    have = {p.stem for p in LOGOS.glob('*') if p.suffix in ('.png', '.none')}
    todo = [e for e in all_eras if (args.only and e['fr'] in args.only)
            or (not args.only and (args.refresh or f"{e['fr']}_{e['first']}" not in have))]
    print(f'{len(todo)} team names to look up')
    found = 0
    for i, e in enumerate(todo, 1):
        key, name = f"{e['fr']}_{e['first']}", e['name']
        out, none = LOGOS / f'{key}.png', LOGOS / f'{key}.none'
        try:
            ov = overrides.get(key)
            if ov == 'NONE':
                img = None
            elif ov and ov.startswith('File:'):
                f = ov.split(':', 1)[1]
                img = (f, file_thumb(f), ov)
            else:
                title = ov or find_article(e, last_use[name] == e['last'])
                img = (logo_image(title, e, e['last'] == fr_last[e['fr']] == now) if title else None) or search_files(e)
            if not img or not img[1]:
                out.unlink(missing_ok=True); review.pop(key, None)
                none.touch()  # marker: badge from this year on, instead of the previous name's logo
                print(f'[{i}/{len(todo)}] {key} {name}: no logo'); continue
            r = S.get(img[1], timeout=60); r.raise_for_status()
            out.write_bytes(r.content); none.unlink(missing_ok=True)
            found += 1
            review[key] = dict(key=key, team=name, years=f"{e['first']}-{e['last']}", league=e['lg'],
                               wikipedia_article=img[2], file=img[0])
            print(f'[{i}/{len(todo)}] {key} {name}: {img[2]} -> {img[0]}')
        except Exception as ex:  # keep going; one bad lookup shouldn't stop the run
            print(f'[{i}/{len(todo)}] {key} {name}: error {ex}', file=sys.stderr)
        time.sleep(0.3)
    with REVIEW.open('w', newline='') as f:
        w = csv.DictWriter(f, ['key', 'team', 'years', 'league', 'wikipedia_article', 'file'])
        w.writeheader(); w.writerows(sorted(review.values(), key=lambda r: r['key']))
    print(f'done: {found} logos fetched this run. Rerun python scripts/build_data.py, then check {REVIEW.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
