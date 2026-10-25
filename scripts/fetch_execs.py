"""Fetch each franchise's principal owners and general managers from Wikipedia's navigation boxes
(e.g. Template:New York Yankees owners, Template:New York Yankees general managers) into data/source/executives.json.

Run from the repo root, after build_data.py, then rerun build_data.py:
    python scripts/fetch_execs.py

Only today's 30 clubs have these boxes. Each franchise gets {"own": [...], "gm": [...]}, every entry
[group (an era of the franchise, or ""), parts, years], where parts are plain strings and [name, article] pairs.
"""
import html, json, re, time
from pathlib import Path
from fetch_photos import api

ROOT = Path(__file__).resolve().parent.parent
ATLAS = ROOT / 'docs' / 'data' / 'atlas.json'
OUT = ROOT / 'data' / 'source' / 'executives.json'
KINDS = {'own': 'owners', 'gm': 'general managers'}


def plain(s, strip=True):
    s = re.sub(r'\{\{\s*by\s*\|\s*(\d{4})\s*\}\}', r'\1', s)
    s = re.sub(r'<ref[^>]*/>|<ref.*?</ref>|\{\{[^{}]*\}\}|<[^>]+>', '', s)
    s = html.unescape(s.replace("'''", '').replace("''", '')).replace('\xa0', ' ')
    return s.strip() if strip else re.sub(r'\s+', ' ', s)


def parse_navbox(wikitext):
    out, group = [], ''
    for line in wikitext.split('\n'):
        m = re.match(r'\s*\|\s*group\d+\s*=\s*(.*)', line)
        if m:
            group = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', plain(m.group(1))); continue
        m = re.match(r'\s*\*+\s*(.+)', line)
        if not m: continue
        item = m.group(1).strip()
        y = re.search(r'\(([^()]*\d{4}[^()]*)\)\s*$', item)
        years = plain(y.group(1)).replace('-', '–') if y else ''
        body = item[:y.start()] if y else item
        parts, pos = [], 0  # separators (", ", " & ") keep their spaces, so the parts join with ''
        for l in re.finditer(r'\[\[([^|\]]+)(?:\|([^\]]+))?\]\]', body):
            parts.append(plain(body[pos:l.start()], strip=False))
            label, target = plain(l.group(2) or l.group(1)), l.group(1).strip()
            if ' ' not in label: label = re.sub(r'\s*\(.*\)$', '', target)  # [[Connie Mack|Mack]] -> Connie Mack
            parts.append([label, target]); pos = l.end()
        parts.append(plain(body[pos:], strip=False))
        if parts and isinstance(parts[0], str): parts[0] = parts[0].lstrip()
        if parts and isinstance(parts[-1], str): parts[-1] = parts[-1].rstrip()
        parts = [p for p in parts if p]
        if parts: out.append([group, parts, years])
    return out


MON = r'(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:\d{1,2},?\s+)?)?'
RANGE = r'(?:1[89]|20)\d\d(?:\s*[–—-]\s*' + MON + r'(?:(?:1[89]|20)?\d\d|present))?'
YEARS = RANGE + r'(?:\s*,\s*' + RANGE + r')*'  # 1934–1940, 1934 – November 1940, 1993–95, 1997–98


def unwrap(text):
    """List-page templates as plain wikitext: {{sortname|Carter|Hawkins}} -> [[Carter Hawkins]], {{mlby|2021}} -> 2021."""
    for _ in range(4):  # innermost first
        text = re.sub(r'\{\{\s*sortname\s*\|([^|{}]+)\|([^|{}]+)(?:\|([^|{}=]+))?[^{}]*\}\}',
                      lambda m: f"[[{m.group(3) or m.group(1) + ' ' + m.group(2)}|{m.group(1)} {m.group(2)}]]", text, flags=re.I)
        text = re.sub(r'\{\{\s*(?:mlby|by|baseball year|year)\s*\|\s*(\d{4})[^{}]*\}\}', r'\1', text, flags=re.I)
        text = re.sub(r'\{\{\s*sort\s*\|[^|{}]*\|([^{}]*)\}\}', r'\1', text, flags=re.I)
    return text.replace('&ndash;', '–').replace('&mdash;', '—')


def list_years(text, target, kind, nth=0):
    """Years for someone the navbox gives without them, from the club's owners-and-executives list: the first
    year range after his link, in the same table row or list line (his nth stint's, when he's listed more than once)."""
    found = []
    for m in re.finditer(r'\[\[\s*' + re.escape(target).replace(r'\ ', '[ _]') + r'\s*[|\]]', text, re.I):
        win = re.split(r'\n\|-|\n\*|\n\n|\n=', text[m.end():m.end() + 600])[0]
        win = re.sub(r'<ref[^>]*/>|<ref.*?</ref>|\{\{[^{}]*\}\}', '', win, flags=re.S)
        g = re.search(r'general manager', win, re.I)
        if kind == 'gm' and g: win = win[g.end():]
        y = re.search(YEARS, plain(win))
        if y: found.append(re.sub(r'\s*[–—-]\s*' + MON, '–', y.group(0)))
    return found[min(nth, len(found) - 1)] if found else ''


def main():
    D = json.loads(ATLAS.read_text())
    now = max(t['y'] for t in D['teams'].values())
    out = {}
    for fid, f in D['franch'].items():
        if D['teams'][f['s'][-1]]['y'] != now: continue
        names = list(dict.fromkeys([D['teams'][s]['n'] for s in reversed(f['s'])] + [f['n']]))
        for kind, word in KINDS.items():
            titles = [f'Template:{n} {word}' for n in names]
            q = api(action='query', titles='|'.join(titles[:50]), redirects=1)
            found = {p['title'] for p in q['query']['pages'] if not p.get('missing')}
            redir = {r['from']: r['to'] for r in q['query'].get('redirects', [])}
            title = next((redir.get(t, t) for t in titles if redir.get(t, t) in found), None)
            if not title:
                print(f'{fid} {f["n"]}: no {word} box'); continue
            rows = parse_navbox(api(action='parse', page=title, prop='wikitext')['parse']['wikitext'])
            if any(not r[2] for r in rows):
                lst = next((x for x in [f'List of {n} owners and executives' for n in names] + [f'List of {names[0].split()[-1]} owners and executives']
                            if not api(action='query', titles=x, redirects=1)['query']['pages'][0].get('missing')), None)
                text = unwrap(api(action='parse', page=lst, prop='wikitext', redirects=1)['parse']['wikitext']) if lst else ''
                seen = {}
                for r in rows:
                    who = next((x[1] for x in r[1] if isinstance(x, list)), None)
                    if not who: continue
                    seen[who] = seen.get(who, -1) + 1
                    if not r[2]: r[2] = list_years(text, who, kind, seen[who])
            if rows: out.setdefault(fid, {})[kind] = rows
            print(f'{fid} {f["n"]}: {title}, {len(rows)} {word}, {sum(1 for r in rows if not r[2])} without years')
            time.sleep(0.5)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f'wrote {OUT.relative_to(ROOT)} ({len(out)} franchises). Rerun python scripts/build_data.py')


if __name__ == '__main__':
    main()
