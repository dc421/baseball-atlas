"""Fetch one Wikipedia photo per player into docs/photos/ and record credits in docs/data/photos.json.

Run from the repo root, after build_data.py:
    python scripts/fetch_photos.py            # only players without a photo yet
    python scripts/fetch_photos.py --refresh  # redo everyone
    python scripts/fetch_photos.py --only ruthba01 nichoki01

Wrong person or a bad crop? Add a row to data/overrides/photo_titles.csv
(key = the player's id in the atlas URL, title = the exact Wikipedia article title,
or title = NONE to skip that player), then rerun with --only <key>.
Check data/photo_review.csv after a run to spot mismatches quickly.
"""
import argparse, csv, html, json, re, sys, time
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
ATLAS = ROOT / 'docs' / 'data' / 'atlas.json'
MANIFEST = ROOT / 'docs' / 'data' / 'photos.json'
PHOTOS = ROOT / 'docs' / 'photos'
OVERRIDES = ROOT / 'data' / 'overrides' / 'photo_titles.csv'
REVIEW = ROOT / 'data' / 'photo_review.csv'
API = 'https://en.wikipedia.org/w/api.php'
S = requests.Session()
S.headers['User-Agent'] = 'LivingAtlasOfBaseball/1.0 (personal hobby project; https://github.com/dc421/baseball-atlas)'


def api(**params):
    params.update(format='json', formatversion=2)
    for attempt in range(4):
        r = S.get(API, params=params, timeout=30)
        if r.status_code == 429:
            time.sleep(5 * (attempt + 1)); continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError('Wikipedia kept saying slow down; try again later')


def find_title(p):
    name = f"{p['f']} {p['l']}"
    res = api(action='query', list='search', srsearch=f'{name} baseball', srlimit=5)
    last = p['l'].split()[-1].lower()
    for hit in res['query']['search']:
        t = hit['title']
        if last in t.lower() and 'list of' not in t.lower() and 'season' not in t.lower():
            return t
    return None


def strip_html(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s or ''))).strip()


def photo_for(title):
    q = api(action='query', titles=title, redirects=1, prop='pageimages', piprop='thumbnail|name', pithumbsize=400)
    page = q['query']['pages'][0]
    thumb, fname = page.get('thumbnail', {}).get('source'), page.get('pageimage')
    if not thumb or not fname:
        return None
    meta = api(action='query', titles='File:' + fname, prop='imageinfo', iiprop='extmetadata')
    info = (meta['query']['pages'][0].get('imageinfo') or [{}])[0].get('extmetadata', {})
    return dict(thumb=thumb, file_name=fname, page=page['title'],
                credit=strip_html(info.get('Artist', {}).get('value', ''))[:120],
                license=strip_html(info.get('LicenseShortName', {}).get('value', '')))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--only', nargs='*')
    args = ap.parse_args()
    players = json.loads(ATLAS.read_text())['players']
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    overrides = {}
    if OVERRIDES.exists():
        with OVERRIDES.open() as f:
            overrides = {r['key']: r['title'] for r in csv.DictReader(f)}
    PHOTOS.mkdir(parents=True, exist_ok=True)
    todo = [k for k in players if (args.only and k in args.only) or (not args.only and (args.refresh or k not in manifest))]
    print(f'{len(todo)} players to look up')
    review = []
    for i, k in enumerate(todo, 1):
        p = players[k]; name = f"{p['f']} {p['l']}"
        try:
            title = overrides.get(k) or find_title(p)
            if not title or title == 'NONE':
                print(f'[{i}/{len(todo)}] {name}: no article found'); continue
            ph = photo_for(title)
            if not ph:
                print(f'[{i}/{len(todo)}] {name}: article "{title}" has no lead photo'); continue
            ext = Path(ph['thumb'].split('?')[0]).suffix.lower() or '.jpg'
            out = PHOTOS / f'{k}{ext}'
            img = S.get(ph['thumb'], timeout=60); img.raise_for_status()
            out.write_bytes(img.content)
            manifest[k] = dict(file=out.name, page=ph['page'], source=ph['file_name'], credit=ph['credit'] or 'Wikimedia Commons', license=ph['license'])
            review.append([k, name, ph['page'], ph['file_name'], ph['license']])
            print(f'[{i}/{len(todo)}] {name}: {ph["page"]} ({ph["license"] or "license unknown"})')
        except Exception as e:  # keep going; one bad lookup shouldn't stop the run
            print(f'[{i}/{len(todo)}] {name}: error {e}', file=sys.stderr)
        time.sleep(0.3)
        if i % 25 == 0:
            MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    with REVIEW.open('w', newline='') as f:
        w = csv.writer(f); w.writerow(['key', 'player', 'wikipedia_article', 'file', 'license']); w.writerows(review)
    print(f'done: {len(manifest)} players have photos. Review matches in {REVIEW.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
