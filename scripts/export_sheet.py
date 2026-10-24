"""Export the tabs the atlas needs from your Numbers file into data/source/*.csv.

    python scripts/export_sheet.py ~/path/to/Baseball_Watch_List.numbers

Tabs used: IN, Year-by-Year Top 5, Games, Parks R/L, Checklist.
Only the IN columns the atlas uses are kept (memorabilia values stay out of the repo).
If numbers-parser errors about protobuf versions: pip install -U protobuf
"""
import csv, sys
from pathlib import Path
from numbers_parser import Document

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'source'
TABS = {'IN': 'IN.csv', 'Year-by-Year Top 5': 'Year-by-Year_Top_5.csv', 'Games': 'Games.csv', 'Parks R/L': 'Parks_R-L.csv', 'Checklist': 'Checklist.csv'}
IN_COLS = ['Peak', 'First', 'Last', 'POS', 'OVR', 'PosRk', 'Vid', 'SABR', 'Int', 'Bio', 'Have']


def main(path):
    doc = Document(path)
    OUT.mkdir(parents=True, exist_ok=True)
    for sheet in doc.sheets:
        if sheet.name not in TABS: continue
        rows = [['' if v is None else v for v in r] for r in sheet.tables[0].rows(values_only=True)]
        if sheet.name == 'IN':
            head = [str(h) for h in rows[0]]
            idx = [head.index(c) for c in IN_COLS]  # first match wins (IN has a second "Have" column)
            rows = [[r[i] for i in idx] for r in rows]
            rows = [rows[0]] + [r for r in rows[1:] if str(r[2]).strip()]
        with (OUT / TABS[sheet.name]).open('w', newline='') as f:
            csv.writer(f).writerows(rows)
        print(f'wrote data/source/{TABS[sheet.name]} ({len(rows) - 1} rows)')


if __name__ == '__main__':
    if len(sys.argv) != 2: sys.exit(__doc__)
    main(sys.argv[1])
