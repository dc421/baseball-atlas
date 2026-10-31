"""Download Retrosheet data into data/retrosheet/ (gitignored); build_data.py reads the zips.

    python scripts/fetch_retrosheet.py

Game logs (line scores, lineups): regular season 1871-2025 plus the World Series, League Championship, Division and
Wild Card logs. Box scores and play-by-play (every batter's and pitcher's line, every play, by game): the postseason and Negro Leagues
CSV files (and biodata.zip: team and park names), plus every season's file (csv/<year>csvs.zip, about 4 MB each), which
scripts/build_games.py reads to rank every game.
The information used here was obtained free of charge from and is copyrighted by Retrosheet.
Interested parties may contact Retrosheet at www.retrosheet.org.
"""
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'retrosheet'
FILES = ['gl1871_2025.zip', 'glws.zip', 'gllc.zip', 'gldv.zip', 'glwc.zip']
LAST = 2025  # the latest season Retrosheet has published


def get(url, dest):
    if dest.exists(): return
    r = requests.get(url, timeout=600); r.raise_for_status()
    dest.write_bytes(r.content)
    print(f'wrote {dest.relative_to(ROOT)} ({len(r.content) / 1e6:.1f} MB)')


if __name__ == '__main__':
    (OUT / 'csv').mkdir(parents=True, exist_ok=True)
    for f in FILES: (OUT / f).unlink(missing_ok=True); get(f'https://www.retrosheet.org/gamelogs/{f}', OUT / f)
    for f in ['postseason', 'negroleagues', 'biodata']: get(f'https://www.retrosheet.org/downloads/{f}.zip', OUT / 'csv' / f'{f}.zip')
    for y in range(1901, LAST + 1): get(f'https://www.retrosheet.org/downloads/{y}/{y}csvs.zip', OUT / 'csv' / f'{y}csvs.zip')
