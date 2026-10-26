"""Find a YouTube video for each game on your list, saved to data/source/game_videos.csv.

    python scripts/fetch_videos.py          # only games without a video yet (or whose pick can't be embedded)
    python scripts/fetch_videos.py --all    # look everything up again

Run after build_data.py (it reads the written-out titles from docs/data/atlas.json), then rebuild.
Searches "<year> <title> <teams> full game" and takes the first result that is about this game, can be played
on other websites. Prefers broadcasts over 90 minutes, then shorter footage; duration does not prove completeness. To pick one yourself, put it in data/overrides/game_videos.csv
(rk,video); it wins over the search. You can also paste a better link in the game page's Video section.
"""
import csv, json, re, sys, time
from pathlib import Path
from urllib.parse import quote_plus
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'source' / 'game_videos.csv'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
FIELDS = ['rk', 'video', 'title', 'channel', 'mins', 'query']
FULL = 90  # prefer long broadcasts; duration alone cannot prove completeness


def text(s):  # a JSON string body from the page; the regex can stop at an escaped quote, so don't insist it parses
    try: return json.loads(f'"{s}"')
    except ValueError: return s.replace('\\"', '"').replace('\\u0026', '&')


def results(h):  # search page -> [(id, title, channel, minutes)]
    out = []
    for p in h.split('"videoRenderer":{"videoId":"')[1:20]:
        t = re.search(r'"title":\{"runs":\[\{"text":"(.*?)"\}', p); o = re.search(r'"ownerText":\{"runs":\[\{"text":"(.*?)"', p)
        ln = re.search(r'"lengthText":\{.*?"simpleText":"([\d:]+)"', p)
        if not t: continue
        hms = [int(x) for x in ln[1].split(':')] if ln else []
        mins = sum(v * 60 ** i for i, v in enumerate(reversed(hms))) / 60 if hms else 0
        out.append((p[:11], text(t[1]), text(o[1]) if o else '', round(mins)))
    return out


def fold(s):
    import unicodedata
    return re.sub(r'[^a-z0-9# ]', ' ', unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower())


def relevant(g, title):
    """Require the season and matchup/round; reject other games and fan simulations."""
    t = fold(title); y = str(g['y'])
    if re.search(r'watch[ -]?(?:along|party)|gameszn|simulat|mlb the show|\bthe show \d|\b(?:mlb|mvp) 2k|pine tar|strat o matic|ootp|replay baseball|world series game review', t): return False
    years = re.findall(r'\b(?:18|19|20)\d\d\b', t)
    if y not in years or any(v != y for v in years): return False
    n = re.search(r'G(\d+)$', g['g'])
    said = re.findall(r'\b(?:game|gm|g)\s*#?\s*(\d+)\b', t)
    if n and (not said or any(v != n[1] for v in said)): return False
    teams = [fold(v).split()[-1] for v in g.get('nm', [])]
    matchup = teams and all(re.search(r'\b' + re.escape(v) + r'\b', t) for v in teams)
    gt = g.get('gt', '')
    stage = next((v for k, v in [('World Series', r'world series|\bws\b'),
                               ('Championship Series', r'\b' + ('alcs' if gt.startswith('American') else 'nlcs') + r'\b'),
                               ('Division Series', r'\b' + ('alds' if gt.startswith('American') else 'nlds') + r'\b')]
                  if k in gt), None)
    if n: return bool(matchup or (stage and re.search(stage, t)))
    # A regular-season upload must identify the actual day as well as both teams.
    date = re.search(r'(\d{1,2})/(\d{1,2})', g['g'])
    if date:
        import calendar
        mo, day = map(int, date.groups())
        dates = [rf'\b0?{mo} 0?{day}\b', rf'\b{calendar.month_name[mo].lower()} 0?{day}\b',
                 rf'\b{calendar.month_abbr[mo].lower()} 0?{day}\b', rf'\b0?{day} 0?{mo}\b']
        return bool(matchup and any(re.search(d, t) for d in dates))
    return bool(matchup)


def embeddable(v):
    try: return requests.get(f'https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={v}&format=json', timeout=20).status_code == 200
    except requests.RequestException: return False


def query(g):
    return ' '.join(x for x in [str(g['y']), g.get('gt') or g['g'], (g.get('vs') or '').replace(' at ', ' '), 'full game'] if x)


def pick(g, q):
    h = requests.get('https://www.youtube.com/results?search_query=' + quote_plus(q), headers={'User-Agent': UA, 'Accept-Language': 'en-US'}, timeout=30).text
    ok = [r for r in results(h) if relevant(g, r[1])]
    for want_full in (True, False):
        for r in ok:
            if (r[3] >= FULL or not want_full) and embeddable(r[0]): return r
    return None


def main(redo):
    games = json.load(open(ROOT / 'docs' / 'data' / 'atlas.json'))['games']
    have = {r['rk']: r for r in csv.DictReader(open(OUT))} if OUT.exists() else {}
    overrides = ROOT / 'data' / 'overrides' / 'game_videos.csv'
    manual = {r['rk'] for r in csv.DictReader(open(overrides))} if overrides.exists() else set()
    todo = [g for g in sorted(games.values(), key=lambda g: g['rk']) if str(g['rk']) not in manual and (redo or str(g['rk']) not in have or not have[str(g['rk'])].get('video')
            or not relevant(g, have[str(g['rk'])]['title']) or not embeddable(have[str(g['rk'])]['video']))]
    print(f'{len(todo)} games to look up')
    for i, g in enumerate(todo):
        q = query(g)
        try: m = pick(g, q)
        except requests.RequestException as e: print('  failed:', q, e); m = None
        have[str(g['rk'])] = dict(rk=g['rk'], video=m[0] if m else '', title=m[1] if m else '', channel=m[2] if m else '', mins=m[3] if m else '', query=q)
        if i % 25 == 0:
            print(f'  {i}/{len(todo)} {q[:60]} -> {have[str(g["rk"])]["title"][:60]}', flush=True)
            write(have)
        time.sleep(1.2)
    write(have)
    print(f'wrote {OUT.relative_to(ROOT)} ({sum(1 for r in have.values() if r["video"])} with a video, '
          f'{sum(1 for r in have.values() if r["mins"] and int(r["mins"]) >= FULL)} over {FULL} minutes)')


def write(have):
    with OUT.open('w', newline='') as f:
        w = csv.DictWriter(f, FIELDS, extrasaction='ignore', lineterminator='\n'); w.writeheader()
        for r in sorted(have.values(), key=lambda r: int(r['rk'])): w.writerow(r)


if __name__ == '__main__':
    main('--all' in sys.argv)
