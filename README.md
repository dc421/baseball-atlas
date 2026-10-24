# Living Atlas of Baseball

A personal portal to baseball history: a map of every team season since 1871 (Negro Leagues included), rankings of your players and greatest games, and places (countries, states, cities) with the best players from them, the best who played there, and the best teams they've had. Every player, team and game has doors to open (film, photos, SABR, newspapers, Baseball-Reference) and lights that come on as you explore.

The site is plain HTML/JS in `docs/`, so GitHub Pages can serve it directly.

## Run it locally

```bash
cd docs && python3 -m http.server 8000
# open http://localhost:8000
```

## Put it online (GitHub Pages)

Repo **Settings → Pages → Build and deployment**: Source "Deploy from a branch", branch `main`, folder `/docs`. The site appears at `https://dc421.github.io/baseball-atlas/`.
(Pages on a private repo needs a paid GitHub plan.)

## Updating the data

```bash
pip install -r requirements.txt
python scripts/export_sheet.py ~/path/to/Baseball_Watch_List.numbers   # your list -> data/source/*.csv
python scripts/build_data.py                                            # -> docs/data/atlas.json
python scripts/fetch_photos.py                                          # Wikipedia photos -> docs/photos/
python scripts/fetch_logos.py                                           # Wikipedia logos -> docs/logos/ (then rerun build_data.py)
python scripts/build_notes.py                                           # your Baseball History doc -> docs/data/notes.json
```

- **Your list** comes from the IN, Year-by-Year Top 5, Games, Parks R/L and Checklist tabs. Only the IN columns the site uses are exported.
- **Everything else** (careers, birthplaces, teams, parks, stats through 2025) comes from the Lahman database via the `pylahman` package.
- **Hand fixes** live in `data/overrides/`:
  - `player_ids.csv`: force a player match (or `NONE` for players outside the database)
  - `manual_players.csv`: players outside the database (NPB, Cuba, Mexico...), with home clubs
  - `from_places.csv`: where a player is "from" when it shouldn't be his birthplace
  - `team_cities.csv`: locations for teams without a home-park record (mostly Negro League and Cuban clubs)
  - `team_colors.csv`: badge colors per franchise
  - `photo_titles.csv`: the Wikipedia article to use when the photo script picks the wrong person (`NONE` to skip)
- **Logos**: see `docs/logos/README.md`.

## Your progress

Check-offs, grades, clippings, pins and "from" changes save in the browser you use. To keep them safe or share them across devices, use **Export progress** (bottom of the Teams view) and commit the file as `docs/data/progress.json`. Every browser that opens the site starts from that file, and newer local changes win.

## Layout

```
docs/            the website (index.html, app.js, style.css, data/, photos/, logos/, vendor/)
scripts/         export_sheet.py, build_data.py, fetch_photos.py, fetch_logos.py, build_notes.py
data/source/     CSVs exported from your spreadsheet
data/overrides/  hand fixes
```
