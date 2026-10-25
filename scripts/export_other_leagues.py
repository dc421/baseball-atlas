"""Save the Japan Hitters / Japan Pitchers tabs of your ratings sheet (NPB and Cuban seasons) to data/source/ for the build.

    python scripts/export_other_leagues.py

The sheet is the public one Baseball Ratings 2023.R reads (non_mlb_hitters, japan_hitters...). These fill in
year-by-year tables for players outside the Lahman database (Oh, Nagashima, Nomura...).
"""
from pathlib import Path
from urllib.parse import quote
import requests

ROOT = Path(__file__).resolve().parent.parent
SHEET = '1JK369FtI402xB1RnL6qaaKf9pdEoAONDLFIopaB4Q5o'
TABS = {'Japan Hitters': 'japan_hitters.csv', 'Japan Pitchers': 'japan_pitchers.csv'}  # Japan and Cuba; the other tabs are full-season translations

if __name__ == '__main__':
    for tab, f in TABS.items():
        r = requests.get(f'https://docs.google.com/spreadsheets/d/{SHEET}/gviz/tq?tqx=out:csv&sheet={quote(tab)}', timeout=60)
        r.raise_for_status()
        (ROOT / 'data' / 'source' / f).write_bytes(r.content)
        print(f'wrote data/source/{f} ({len(r.content.splitlines()) - 1} rows)')
