"""Split your "Baseball History" Google Doc into the atlas's notes: docs/data/notes.json.

    python scripts/build_notes.py

Reads data/source/Baseball_History.md (the doc as text; ask Claude to refresh it from Google Drive,
or File > Download > Markdown). Bold year headings (**1884**) become year notes, **1940s**-style
headings become decade notes, and any bold heading naming a player on your list (**#5 Ty Cobb**,
**SP #46: J.R. Richard**, **Bill Joyce**) starts that player's notes. Everything before 1871 is the
"Before 1871" page. Lines that are reminders to yourself (Weebly, PICK UP...) are left out.
"""
import json, re, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'data' / 'source' / 'Baseball_History.md'
OUT = ROOT / 'docs' / 'data' / 'notes.json'
SKIP = re.compile(r'weebly|pick up bio|double check|make more conversational|^<iframe|datawrapper|^\\?<', re.I)
QUICK_MAX = 400  # year notes: short lines before the first long paragraph are the quick notes (rule changes etc.)


def fold(s):
    return re.sub(r'[^a-z ]', '', unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()).strip()


def clean(line):
    s = line.replace('\u200b', '').strip()
    s = re.sub(r'\\([#!\[\]()*_<>-])', r'\1', s)
    s = re.sub(r'\*\*', '', s).strip()
    return s


def heading(line):
    m = re.fullmatch(r'\s*\*\*(.+?)\*\*\s*', line.replace('\u200b', ''))
    return clean(m.group(1)) if m else None


def paras(lines):
    out = []
    for l in lines:
        s = clean(l)
        if s and not SKIP.search(s):
            out.append(s)
    return out


def main():
    lines = SRC.read_text().split('\n')
    players = json.loads((ROOT / 'docs' / 'data' / 'atlas.json').read_text())['players']
    names = {}
    for k, p in players.items():
        names.setdefault(fold(f"{p['f']} {p['l']}"), k)
    # section starts: (line index, kind, id)
    starts = []
    for i, l in enumerate(lines):
        h = heading(l)
        if h is None:
            continue
        if re.fullmatch(r'1[89]\d\d|20[0-2]\d', h) and i > 200:
            starts.append((i, 'year', h))
        elif re.fullmatch(r'(19|20)\d0s', h):
            starts.append((i, 'decade', h[:4]))
        else:
            bare = re.sub(r'^[A-Z][A-Z /&-]+:\s*', '', h)                      # "FIELD: SS Rabbit Maranville"
            bare = re.sub(r'^(?:[A-Z0-9]{1,3} )?#\d+:? ', '', bare)            # "#5 Ty Cobb", "SP #46: J.R. Richard"
            bare = re.sub(r'^(?:C|1B|2B|3B|SS|LF|CF|RF|OF|SP|RP|P) ', '', bare)
            nm = fold(bare)
            if i > 1000 and nm in names:
                starts.append((i, 'player', names[nm]))
            elif i > 1000 and (re.match(r'(?:[A-Z][A-Z /&-]+:\s*)?(?:[A-Z0-9]{1,3} )?#\d+', h) or re.fullmatch(r'[A-Z][A-Z0-9 /&,#-]+:?', h)
                               or re.fullmatch(r"(?:[A-Z][\w.'’-]*\.? ?){2,4}", bare)):
                starts.append((i, 'other', h))  # someone not on your list, or a list header: ends the previous player
    first_year = next(i for i, kind, _ in starts if kind == 'year')
    out = {'pre': paras(lines[15:first_year]), 'years': {}, 'decades': {}, 'players': {}}
    for n, (i, kind, ident) in enumerate(starts):
        end = starts[n + 1][0] if n + 1 < len(starts) else len(lines)
        body = paras(lines[i + 1:end])
        if kind == 'player':
            # the doc's tail holds lists and drafts, not bios: stop a player's notes at the next non-player block
            out['players'].setdefault(ident, []).extend(body)
        elif kind == 'other':
            continue
        elif kind == 'year':
            cut = next((j for j, p in enumerate(body) if len(p) > QUICK_MAX), len(body))
            out['years'][ident] = {'quick': body[:cut], 'text': body[cut:]}
        else:
            quick, text = [], []
            for p in body:
                m = re.match(r'(1[89]\d\d|20[0-2]\d)\??:\s*(.+)', p)
                if m:
                    y = out['years'].setdefault(m.group(1), {'quick': [], 'text': []})
                    y['quick'].append(m.group(2))
                (quick if len(p) <= QUICK_MAX else text).append(p)
            out['decades'][ident] = {'quick': quick, 'text': text}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out['years'])} years, {len(out['decades'])} decades, "
          f"{len(out['players'])} players, {len(out['pre'])} paragraphs before 1871 ({OUT.stat().st_size // 1024} KB)")


if __name__ == '__main__':
    main()
