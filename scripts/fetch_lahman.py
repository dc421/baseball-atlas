"""Download the Lahman database CSVs the atlas needs into data/lahman/ (gitignored).

    python scripts/fetch_lahman.py

Source: SABR's Lahman Baseball Database, version 2025 (1871-2025, Negro Leagues included),
comma-delimited release at https://sabr.org/lahman-database/. SABR shares it as a Box folder;
file ids are read from the folder pages, so a re-uploaded file is picked up automatically.
"""
import re, sys
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'lahman'
SHARE = 'y1prhc795jk8zvmelfd3jq7tl389y6cd'  # "lahman_1871-2025_csv" on sabr.box.com
NEED = ['People', 'Appearances', 'Teams', 'HomeGames', 'Parks', 'TeamsFranchises', 'Batting', 'Pitching', 'Managers']


def file_ids():
    ids = {}
    for page in range(1, 6):
        html = requests.get(f'https://sabr.box.com/s/{SHARE}', params={'page': page}, timeout=60).text
        found = dict((n, i) for i, n in re.findall(r'"typedID":"(f_\d+)".{0,200}?"name":"([^"]+)"', html))
        if not found or set(found) <= set(ids): break
        ids.update(found)
    return ids


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ids = file_ids()
    missing = [n for n in NEED if n + '.csv' not in ids]
    if missing: sys.exit(f'Not in the SABR folder: {missing}. Check https://sabr.org/lahman-database/ for a newer link.')
    for n in NEED:
        r = requests.get('https://sabr.box.com/index.php', timeout=300, params={
            'rm': 'box_download_shared_file', 'shared_name': SHARE, 'file_id': ids[n + '.csv']})
        r.raise_for_status()
        if not r.content[:200].lstrip(b'\xef\xbb\xbf').split(b'\n')[0].count(b','):
            sys.exit(f'{n}.csv did not download as a CSV (got {r.headers.get("content-type")})')
        (OUT / f'{n}.csv').write_bytes(r.content)
        print(f'wrote data/lahman/{n}.csv ({len(r.content) / 1e6:.1f} MB)')


if __name__ == '__main__':
    main()
