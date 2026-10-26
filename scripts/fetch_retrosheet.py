"""Download Retrosheet data into data/retrosheet/ (gitignored); build_data.py reads the zips.

    python scripts/fetch_retrosheet.py

Game logs (line scores, lineups): regular season 1871-2025 plus the World Series, League Championship, Division and
Wild Card logs. Box scores (every batter's and pitcher's line, by game): the postseason and Negro Leagues CSV files (and biodata.zip: team and park names),
plus each season's file for the years with a regular-season game on your list (csv/<year>csvs.zip).
The information used here was obtained free of charge from and is copyrighted by Retrosheet.
Interested parties may contact Retrosheet at www.retrosheet.org.
"""
import re
from pathlib import Path
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'retrosheet'
FILES = ['gl1871_2025.zip', 'glws.zip', 'gllc.zip', 'gldv.zip', 'glwc.zip']
DATE = re.compile(r'\d{1,2}/\d{1,2}')


def get(url, dest):
    if dest.exists(): return
    r = requests.get(url, timeout=600); r.raise_for_status()
    dest.write_bytes(r.content)
    print(f'wrote {dest.relative_to(ROOT)} ({len(r.content) / 1e6:.1f} MB)')


if __name__ == '__main__':
    (OUT / 'csv').mkdir(parents=True, exist_ok=True)
    for f in FILES: (OUT / f).unlink(missing_ok=True); get(f'https://www.retrosheet.org/gamelogs/{f}', OUT / f)
    for f in ['postseason', 'negroleagues', 'biodata']: get(f'https://www.retrosheet.org/downloads/{f}.zip', OUT / 'csv' / f'{f}.zip')
    gm = pd.read_csv(ROOT / 'data' / 'source' / 'Games.csv', dtype=str).fillna('')
    years = {int(float(r.Year)) for r in gm.itertuples() if r.Year and DATE.search(r.Game)}
    mg = ROOT / 'data' / 'overrides' / 'manual_games.csv'
    if mg.exists(): years |= {int(r.y) for r in pd.read_csv(mg, dtype=str).itertuples() if DATE.search(r.g)}
    for y in sorted(years): get(f'https://www.retrosheet.org/downloads/{y}/{y}csvs.zip', OUT / 'csv' / f'{y}csvs.zip')
