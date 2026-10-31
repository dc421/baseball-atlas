"""Download play-by-play for the postseasons Retrosheet hasn't published yet, from the MLB Stats API, into
data/retrosheet/mlbapi/<year>/ (gitignored); build_games.py ranks these games with the rest.

    python scripts/fetch_mlbapi.py          # rerun after each game: finished games are kept, new ones added

Use of this data acknowledges MLB Advanced Media's terms: http://gdx.mlb.com/components/copyright.txt
"""
import datetime, json
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'retrosheet' / 'mlbapi'
LAST = 2025  # the latest season Retrosheet has published
API = 'https://statsapi.mlb.com/api'


def get(url):
    r = requests.get(url, timeout=60); r.raise_for_status()
    return r.json()


if __name__ == '__main__':
    for y in range(LAST + 1, datetime.date.today().year + 1):
        d = OUT / str(y); d.mkdir(parents=True, exist_ok=True)
        sched = get(f'{API}/v1/schedule?sportId=1&gameType=F,D,L,W&season={y}')
        done = [g for day in sched['dates'] for g in day['games'] if g['status']['abstractGameState'] == 'Final' and g['status']['codedGameState'] == 'F']
        n = 0
        for g in done:
            f = d / f"{g['gamePk']}.json"
            if f.exists(): continue
            f.write_text(json.dumps(get(f"{API}/v1.1/game/{g['gamePk']}/feed/live")))
            n += 1
        print(f'{y}: {len(done)} finished postseason games ({n} new)')
