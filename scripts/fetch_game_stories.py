"""The Wikipedia write-up of each postseason game on your list -> data/source/game_stories.json.

    python scripts/fetch_game_stories.py

Run after build_data.py (it reads the written-out titles and teams from docs/data/atlas.json), then rebuild.
Each series article ("2017 World Series", "2017 American League Division Series", "1942 Negro World Series"...)
has a "Game 5" section; division series articles have one per matchup, found by the two teams' names. Regular-season
games have no such section, so they're left out. The game page shows the section's paragraphs, linked to it.
"""
import json, re, time, unicodedata
from pathlib import Path
from urllib.parse import quote
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'source' / 'game_stories.json'
API = 'https://en.wikipedia.org/w/api.php'
UA = {'User-Agent': 'baseball-atlas/1.0 (personal project; https://github.com/dc421/baseball-atlas)'}


WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']  # older articles: "Game Two"


def fold(s): return ' '.join(re.sub(r'[^a-z0-9 ]', ' ', unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()).split())


def articles(g):  # candidate article titles for a game's series, best first
    y, t = g['y'], g.get('gt') or ''
    lg = 'American League' if t.startswith('American') else 'National League' if t.startswith('National') else ''
    if t.startswith('World Series'): return [f'{y} World Series']
    if t.startswith('Negro World Series'): return [f'{y} Colored World Series' if y < 1930 else f'{y} Negro World Series']
    if 'Championship Series' in t: return [f'{y} {lg} Championship Series']
    if 'Division Series' in t: return [f'{y} {lg} Division Series']
    if 'Wild Card' in t: return [f'{y} {lg} Wild Card Game', f'{y} {lg} Wild Card Series']
    return []


cache = {}
def extract(title):
    if title not in cache:
        r = requests.get(API, params=dict(action='query', prop='extracts', explaintext=1, format='json', redirects=1, titles=title), headers=UA, timeout=30).json()
        p = next(iter(r['query']['pages'].values()))
        cache[title] = (p.get('title', title), p.get('extract') or '')
        time.sleep(0.5)
    return cache[title]


def sections(text):  # -> [(level, heading, body)]
    out, cur = [], (1, '', [])
    for line in text.split('\n'):
        if m := re.match(r'^(=+) (.*?) =+$', line):
            out.append(cur); cur = (len(m[1]), m[2], [])
        else: cur[2].append(line)
    out.append(cur)
    return [(lv, h, '\n'.join(b).strip()) for lv, h, b in out]


def story(g):
    n = re.search(r'Game (\d+)$', g.get('gt') or '')
    single = 'Wild Card Game' in (g.get('gt') or '')
    teams = [fold(x.replace(' of Anaheim', '')) for x in g.get('nm') or []]
    aliases = []
    for t in teams:
        size = 2 if t.endswith((' red sox', ' white sox', ' blue jays')) else 1
        words = t.split(); aliases.append([' '.join(words[-size:]), ' '.join(words[:-size])])
    for title in articles(g):
        real, text = extract(title)
        if not text: continue
        secs = sections(text)
        if single:  # the whole game is the article: its summary section, or the lead
            body = next((b for lv, h, b in secs if re.match(r'(Game summary|Summary|Game|Recap)$', h) and b), secs[0][2])
            return paras(body), f'https://en.wikipedia.org/wiki/{quote(real.replace(" ", "_"))}', real
        if not n: continue
        # in a division series article, look only under the matchup naming both teams
        lo, hi = 0, len(secs)
        scoped = False
        if teams:
            for i, (lv, h, _) in enumerate(secs):
                if all(any(a and re.search(r'\b' + re.escape(a) + r'\b', fold(h)) for a in group) for group in aliases):
                    j = next((j for j in range(i + 1, len(secs)) if secs[j][0] <= lv), len(secs))
                    if any(re.match(r'Game (?:\d|' + '|'.join(WORDS[1:]) + ')', x[1]) for x in secs[i + 1:j]): lo, hi, scoped = i, j, True; break  # (not a summary-only heading)
        # Multiple matchups reuse Game 1 headings. Never fall back to the first matchup.
        if ('Division Series' in title or 'Wild Card Series' in title) and not scoped: continue
        for i in range(lo, hi):
            lv, h, b = secs[i]
            if re.match(rf'Game ({n[1]}|{WORDS[int(n[1])]})\b', h) and b:
                k = sum(1 for x in secs[:i] if x[1] == h)  # Wikipedia numbers repeated headings: Game_1, Game_1_2, ...
                anchor = h.replace(' ', '_') + (f'_{k + 1}' if k else '')
                return paras(b), f'https://en.wikipedia.org/wiki/{quote(real.replace(" ", "_"))}#{quote(anchor)}', real
    return None


def paras(body):
    # leave out the dateline ("Wednesday, October 7, 1998, at Yankee Stadium...") and short captions
    return [p.strip() for p in body.split('\n') if len(p.strip()) > 40 and not re.match(r'^\w+day, \w+ \d+, \d{4}', p.strip())]


def main():
    games = json.load(open(ROOT / 'docs' / 'data' / 'atlas.json'))['games']
    out = {}
    for g in sorted(games.values(), key=lambda g: g['rk']):
        try: s = story(g)
        except (requests.RequestException, ValueError) as e: print('  failed:', g['rk'], e); s = None
        if s and s[0]: out[str(g['rk'])] = dict(p=s[0], url=s[1], src=s[2])
        elif articles(g): print(f"  no section: #{g['rk']} {g['y']} {g.get('gt')}")
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f'wrote {OUT.relative_to(ROOT)} ({len(out)} of {len(games)} games)')


if __name__ == '__main__':
    main()
