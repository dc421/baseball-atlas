"""Gather the reading behind player stories: each player's SABR BioProject biography and Wikipedia article, as plain
text, cached in data/stories_src/<key>.json (not committed; it's other people's writing). The stories themselves are
written from these into data/source/player_stories.json, every one linked to the page it came from.

    python scripts/fetch_player_sources.py           # players not cached yet
    python scripts/fetch_player_sources.py --redo    # look everyone up again

Run after build_data.py (it reads docs/data/atlas.json and docs/data/photos.json).
"""
import argparse, html, json, re, time, unicodedata
from pathlib import Path
from urllib.parse import quote, quote_plus
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'stories_src'
API = 'https://en.wikipedia.org/w/api.php'
S = requests.Session(); S.headers['User-Agent'] = 'baseball-atlas/1.0 (personal project)'
WEB = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'}
SKIP_SEC = re.compile(r'^(See also|References|Notes|Sources|Further reading|External links|Bibliography|Citations|Footnotes)$', re.I)


def fold(s):
    return re.sub(r'[^a-z]', '', unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower())


def clean(s):
    s = re.sub(r'<sup.*?</sup>', '', s or '', flags=re.S)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s))).strip()


def api(**params):
    for i in range(4):
        r = S.get(API, params={**params, 'format': 'json'}, timeout=30)
        try: return r.json()
        except ValueError: time.sleep(3 * (i + 1))
    r.raise_for_status(); raise ValueError('no JSON from Wikipedia')


WIKI_TITLE = {'johnsgr02': 'Home Run Johnson', 'monrobi01': 'Bill Monroe (1900s infielder)', 'vargate01': 'Tetelo Vargas', 'xcepedpe': 'Perucho Cepeda', 'xespinhe': 'Héctor Espino', 'gibsojo99': 'Josh Gibson'}  # where the search's first hit is a namesake (a son, a stadium)


def wiki_title(name, p):  # for players without a photo page: the first search hit that's about baseball
    for q in (f'{name} baseball', f'{name} Negro league', name):
        hits = api(action='query', list='search', srsearch=q, srlimit=5)['query']['search']
        for h in hits:
            if fold(p['l']) in fold(h['title']) and re.search(r'baseball|pitcher|outfielder|infielder|catcher|league', h['snippet'], re.I): return h['title']
    return None


def wikipedia(title):  # [title, url, [[section, text], ...]] with the lead as section ''
    q = api(action='query', titles=title, prop='extracts', explaintext=1, exsectionformat='wiki', redirects=1)
    page = next(iter(q['query']['pages'].values()))
    if 'extract' not in page: return None
    secs, cur = [], ['', []]
    for line in page['extract'].split('\n'):
        m = re.match(r'^(=+)\s*(.*?)\s*\1$', line)
        if m: secs.append(cur); cur = [m[2], []]
        elif line.strip(): cur[1].append(line.strip())
    secs.append(cur)
    secs = [[h, '\n'.join(t)] for h, t in secs if t and not SKIP_SEC.match(h)]
    return [page['title'], 'https://en.wikipedia.org/wiki/' + quote(page['title'].replace(' ', '_')), secs]


SABR_SLUG = {'walshed01': 'big-ed-walsh', 'leonadu02': 'dutch-leonard-2', 'tatisfe02': 'fernando-tatis-jr', 'stonege01': 'george-stone-2', 'willike01': 'ken-williams-2'}  # where the guessed page is another man's (a son, a namesake)


def sabr_url(name, p, k=None):  # the BioProject page whose slug carries his surname, by guess and then by site search
    if k in SABR_SLUG: u = f"https://sabr.org/bioproj/person/{SABR_SLUG[k]}/"; return u, requests.get(u, headers=WEB, timeout=30).text
    guess = f"https://sabr.org/bioproj/person/{re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()).strip('-')}/"
    r = requests.get(guess, headers=WEB, timeout=30)
    if r.status_code == 200 and 'post-title' in r.text: return guess, r.text
    h = requests.get('https://sabr.org/?s=' + quote_plus(name), headers=WEB, timeout=30).text
    for u in dict.fromkeys(re.findall(r'https://sabr\.org/bioproj/person/[\w-]+/', h)):
        if fold(p['l']) in fold(u):
            r = requests.get(u, headers=WEB, timeout=30)
            if r.status_code == 200: return u, r.text
    return None, None


def sabr(page):  # the biography's paragraphs, from the title to its Notes/Sources
    i = page.find('post-title'); end = re.search(r'<p>\s*<(?:strong|b)>\s*(Sources|Notes|Acknowledg)', page[i:])
    body = page[i:i + end.start()] if end else page[i:]
    paras = [clean(x) for x in re.findall(r'<p[^>]*>(.*?)</p>', body, re.S)]
    paras = [x for x in paras if len(x) > 60 and not re.match(r'^(Share this|Support SABR|Join SABR|If you can help|Cronkite School|#top )', x)]
    return paras if sum(map(len, paras)) > 1500 else None  # a stub: no biography written yet


def main(a):
    atlas = json.load(open(ROOT / 'docs' / 'data' / 'atlas.json'))['players']
    mani = json.load(open(ROOT / 'docs' / 'data' / 'photos.json'))
    OUT.mkdir(exist_ok=True)
    for i, (k, p) in enumerate(atlas.items()):
        f = OUT / f'{k}.json'
        if f.exists() and not a.redo: continue
        name = f"{p['f']} {p['l']}"; rec = {'name': name, 'pk': p.get('pk'), 'pos': p.get('pos')}
        try:
            t = WIKI_TITLE.get(k) or (mani.get(k) or {}).get('page') or wiki_title(name, p)
            if t: rec['wiki'] = wikipedia(t)
        except (requests.RequestException, KeyError, ValueError) as e: print('  wikipedia failed:', name, e)
        try:
            u, h = sabr_url(name, p, k)
            if u and sabr(h): rec['sabr'] = [u, sabr(h)]
        except requests.RequestException as e: print('  sabr failed:', name, e)
        f.write_text(json.dumps(rec, ensure_ascii=False, indent=0))
        print(f"  {i + 1}/{len(atlas)} {name}: wiki={rec.get('wiki', [None])[0]}, sabr={(rec.get('sabr') or [None])[0]}")
        time.sleep(.5)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--redo', action='store_true')
    main(ap.parse_args())
