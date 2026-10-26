"""Pre-fill player pages: more photos (from each player's Wikipedia article) and a highlights and an
interview video (top YouTube results). Saved to data/source/player_media.json; build_data.py reads it.

    python scripts/fetch_player_media.py --photos     # Wikipedia/Commons images, with licenses
    python scripts/fetch_player_media.py --videos     # YouTube: highlights (footage pre-1925), interview (peak 1925+);
                                                      # also replaces picks that can no longer be played here
    python scripts/fetch_player_media.py --photos --videos --redo   # look everyone up again

Run after build_data.py (it reads docs/data/atlas.json and docs/data/photos.json), then rebuild.
Picks are automatic; fix a bad one by editing the JSON, or add a better link on the player's page.
"""
import argparse, html, json, re, time
from pathlib import Path
from urllib.parse import quote_plus
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'source' / 'player_media.json'
API = 'https://en.wikipedia.org/w/api.php'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
S = requests.Session(); S.headers['User-Agent'] = 'baseball-atlas/1.0 (personal project)'
HIT = re.compile(r'"videoRenderer":\{"videoId":"([\w-]{11})".{0,800}?"title":\{"runs":\[\{"text":"(.*?)"\}.{0,4000}?"ownerText":\{"runs":\[\{"text":"(.*?)"', re.S)
SKIP = re.compile(r'(logo|signature|autograph|\.svg$|flag|icon|plaque|map|chart|stats|card_back|commons-logo|wikiquote|question_book|edit-clear|ambox|crystal|nuvola|baseball_pictogram|_cap_|insignia|seal_of)', re.I)


def clean(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s or '')).strip()


def fold(s):
    import unicodedata
    return re.sub(r'[^a-z]', '', unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower())


def text(s):
    try: return json.loads(f'"{s}"')
    except ValueError: return s.replace('\\"', '"').replace('\\u0026', '&')


def api(**params):  # Wikipedia sometimes answers with an HTML error page when busy: wait and try again
    for i in range(4):
        r = S.get(API, params=params, timeout=30)
        try: return r.json()
        except ValueError: time.sleep(3 * (i + 1))
    r.raise_for_status(); raise ValueError('no JSON from Wikipedia')


def photos(page, main_source, last, n=4):  # images in the article that name the player (surname in file name or caption)
    files = api(action='query', titles=page, prop='images', imlimit=50, format='json', redirects=1)
    titles = [i['title'] for p in files['query']['pages'].values() for i in p.get('images', [])]
    titles = [t for t in titles if re.search(r'\.jpe?g$', t, re.I) and not SKIP.search(t) and t.split(':', 1)[1].replace(' ', '_') != (main_source or '').replace(' ', '_')]
    if not titles: return []
    info = api(action='query', titles='|'.join(titles[:20]), prop='imageinfo', iiprop='url|extmetadata|size', iiurlwidth=400, format='json')
    out = []
    for p in info['query']['pages'].values():
        ii = (p.get('imageinfo') or [{}])[0]; md = ii.get('extmetadata', {})
        if not ii.get('thumburl') or ii.get('width', 0) < 200: continue
        cap = clean(md.get('ImageDescription', {}).get('value'))
        if fold(last) not in fold(p['title'] + ' ' + cap): continue
        if main_source and p['title'].split(':', 1)[1].replace(' ', '_').lower() == main_source.replace(' ', '_').lower(): continue
        out.append(dict(u=ii['thumburl'].split('?')[0], page=ii.get('descriptionurl'), credit=clean(md.get('Artist', {}).get('value')) or 'unknown',
                        license=clean(md.get('LicenseShortName', {}).get('value')), cap=cap[:160]))
    order = {t: i for i, t in enumerate(titles)}
    return sorted(out, key=lambda x: order.get('File:' + (x['page'] or '').rsplit('File:', 1)[-1].replace('_', ' '), 99))[:n]


def embeddable(v):  # YouTube's oEmbed answers 401 when the uploader blocks playback on other websites, 404 when it's gone
    try: return requests.get(f'https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={v}&format=json', timeout=20).status_code == 200
    except requests.RequestException: return True  # can't tell: keep it


def youtube(q, last):  # the first of the top 10 results whose title names the player and that plays here
    h = requests.get('https://www.youtube.com/results?search_query=' + quote_plus(q), headers={'User-Agent': UA, 'Accept-Language': 'en-US'}, timeout=30).text
    first = fold(q.split()[0])
    m = next((x for x in list(HIT.finditer(h))[:10] if first + fold(last) in fold(text(x[2])) and embeddable(x[1])), None)
    return [m[1], text(m[2]), text(m[3])] if m else None


def main(a):
    atlas = json.load(open(ROOT / 'docs' / 'data' / 'atlas.json'))['players']
    mani = json.load(open(ROOT / 'docs' / 'data' / 'photos.json'))
    have = json.load(open(OUT)) if OUT.exists() else {}
    for i, (k, p) in enumerate(atlas.items()):
        cur = have.setdefault(k, {}); name = f"{p['f']} {p['l']}"
        if a.photos and ('ph' not in cur or a.redo) and k in mani and mani[k].get('page'):
            try: cur['ph'] = photos(mani[k]['page'], mani[k].get('source'), p['l'])
            except (requests.RequestException, KeyError, ValueError) as e: print('  photos failed:', name, e)
            time.sleep(.3)
        blocked = a.videos and any(cur.get(f) and not embeddable(cur[f][0]) for f in ('hl', 'iv'))
        if a.videos and ('hl' not in cur or a.redo or blocked):
            try:
                cur['hl'] = youtube(f"{name} {'baseball footage' if (p.get('pk') or 2000) < 1925 else 'highlights'}", p['l']); time.sleep(1.2)
                cur['iv'] = youtube(f'{name} interview', p['l']) if (p.get('pk') or 2000) >= 1925 else None; time.sleep(1.2)
            except requests.RequestException as e: print('  video failed:', name, e)
        if i % 25 == 0:
            print(f"  {i}/{len(atlas)} {name}: {len(cur.get('ph') or [])} photos, hl={bool(cur.get('hl'))}, iv={bool(cur.get('iv'))}")
            OUT.write_text(json.dumps(have, ensure_ascii=False, indent=0))
    OUT.write_text(json.dumps(have, ensure_ascii=False, indent=0))
    print(f"wrote {OUT.relative_to(ROOT)}: {sum(1 for v in have.values() if v.get('ph'))} players with photos, "
          f"{sum(1 for v in have.values() if v.get('hl'))} highlights, {sum(1 for v in have.values() if v.get('iv'))} interviews")


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--photos', action='store_true'); ap.add_argument('--videos', action='store_true'); ap.add_argument('--redo', action='store_true')
    main(ap.parse_args())
