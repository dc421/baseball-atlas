"""Download Retrosheet game logs into data/retrosheet/ (gitignored); build_data.py reads the zips.

    python scripts/fetch_retrosheet.py

Regular season 1871-2025 plus the World Series, League Championship, Division and Wild Card logs.
The information used here was obtained free of charge from and is copyrighted by Retrosheet.
Interested parties may contact Retrosheet at www.retrosheet.org.
"""
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'retrosheet'
FILES = ['gl1871_2025.zip', 'glws.zip', 'gllc.zip', 'gldv.zip', 'glwc.zip']

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for f in FILES:
        r = requests.get(f'https://www.retrosheet.org/gamelogs/{f}', timeout=600)
        r.raise_for_status()
        (OUT / f).write_bytes(r.content)
        print(f'wrote data/retrosheet/{f} ({len(r.content) / 1e6:.1f} MB)')
