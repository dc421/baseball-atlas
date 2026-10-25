"""Find a YouTube video for each game on your list: the top search result, saved to data/source/game_videos.csv.

    python scripts/fetch_videos.py          # only games without a video yet
    python scripts/fetch_videos.py --all    # look everything up again

Run after build_data.py (it reads the written-out titles from docs/data/atlas.json), then rebuild.
The pick is just the first search result; replace a bad one by editing the CSV (or paste a better
link in the game page's Video section).
"""
import csv, json, re, sys, time
from pathlib import Path
from urllib.parse import quote_plus
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'source' / 'game_videos.csv'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
HIT = re.compile(r'"videoRenderer":\{"videoId":"([\w-]{11})".{0,800}?"title":\{"runs":\[\{"text":"(.*?)"\}.{0,4000}?"ownerText":\{"runs":\[\{"text":"(.*?)"', re.S)


def text(s):  # a JSON string body from the page; the regex can stop at an escaped quote, so don't insist it parses
    try: return json.loads(f'"{s}"')
    except ValueError: return s.replace('\\"', '"').replace('\\u0026', '&')


STOP = set('game games series world championship national american league division wild card the and with from that this walkoff walk homer comeback first last inning innings'.split())


def fold(s):
    import unicodedata
    return re.sub(r'[^a-z0-9 ]', ' ', unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower())


def relevant(g, title):
    """A result counts if it doesn't name some other year, and names the year, a team, or a word from your description."""
    t = fold(title); ws = set(t.split()); y = str(g['y'])
    if any(x != y for x in re.findall(r'\b(?:18|19|20)\d\d\b', t)) and y not in t: return False
    keys = {y, y[2:]} | {w for w in fold(g.get('vs')).split() if len(w) > 3} | {w for w in fold(g.get('d')).split() if len(w) >= 5 and w not in STOP}
    return any(k in ws for k in keys)


def query(g):
    words = re.sub(r'[“”"()]', ' ', g.get('d') or '')
    return ' '.join(x for x in [str(g['y']), g.get('gt') or g['g'], g.get('vs') or '', words] if x)


def main(redo):
    games = json.load(open(ROOT / 'docs' / 'data' / 'atlas.json'))['games']
    have = {r['rk']: r for r in csv.DictReader(open(OUT))} if OUT.exists() and not redo else {}
    # look up anything missing, and redo picks that fail the relevance check (earlier runs took the top result blindly)
    todo = [g for g in sorted(games.values(), key=lambda g: g['rk']) if str(g['rk']) not in have or (have[str(g['rk'])]['video'] and not relevant(g, have[str(g['rk'])]['title']))]
    print(f'{len(todo)} games to look up')
    for i, g in enumerate(todo):
        q = query(g)
        try:
            h = requests.get('https://www.youtube.com/results?search_query=' + quote_plus(q), headers={'User-Agent': UA, 'Accept-Language': 'en-US'}, timeout=30).text
            m = next((x for x in list(HIT.finditer(h))[:10] if relevant(g, text(x[2]))), None)
        except requests.RequestException as e:
            print('  failed:', q, e); m = None
        have[str(g['rk'])] = dict(rk=g['rk'], video=m[1] if m else '', title=text(m[2]) if m else '', channel=text(m[3]) if m else '', query=q)
        if i % 25 == 0:
            print(f'  {i}/{len(todo)} {q[:60]} -> {have[str(g["rk"])]["title"][:60]}')
            write(have)
        time.sleep(1.2)
    write(have)
    print(f'wrote {OUT.relative_to(ROOT)} ({sum(1 for r in have.values() if r["video"])} with a video)')


def write(have):
    with OUT.open('w', newline='') as f:
        w = csv.DictWriter(f, ['rk', 'video', 'title', 'channel', 'query']); w.writeheader()
        for r in sorted(have.values(), key=lambda r: int(r['rk'])): w.writerow(r)


if __name__ == '__main__':
    main('--all' in sys.argv)
