# Move the Needle

A personal portal to baseball history: a map of every team season since 1871 (Negro Leagues included), rankings of your players and greatest games, a page for each franchise (organized by city) and for the other leagues your players played in. Every player, team and game has doors to open (film, photos, SABR, newspapers, Baseball-Reference) and lights that come on as you explore.

The site is plain HTML/JS in `docs/`, so GitHub Pages can serve it directly.

## Run it locally

```bash
cd docs && python3 -m http.server 8000
# open http://localhost:8000
```

Run the game-content regression checks with `python -m unittest discover -s tests -v` after installing the Python requirements.

## Put it online (GitHub Pages)

Repo **Settings → Pages → Build and deployment**: Source "Deploy from a branch", branch `main`, folder `/docs`. The site appears at `https://dc421.github.io/baseball-atlas/`.
(Pages on a private repo needs a paid GitHub plan.)

## Updating the data

```bash
pip install -r requirements.txt
python scripts/fetch_lahman.py                                          # Lahman 2025 CSVs from SABR -> data/lahman/
python scripts/export_sheet.py ~/path/to/Baseball_Watch_List.numbers   # your list -> data/source/*.csv
Rscript scripts/export_ratings.R                                        # your rating model -> data/source/ratings_*.csv (slow)
python scripts/build_data.py                                            # -> docs/data/atlas.json
python scripts/fetch_photos.py                                          # Wikipedia photos -> docs/photos/
python scripts/fetch_logos.py                                           # Wikipedia logos -> docs/logos/ (then rerun build_data.py)
python scripts/build_notes.py                                           # your Baseball History doc -> docs/data/notes.json
python scripts/export_other_leagues.py                                  # Japan/Cuba seasons from your ratings sheet -> data/source/japan_*.csv
python scripts/fetch_retrosheet.py                                      # Retrosheet logs, box scores and play-by-play -> data/retrosheet/ (~770 MB)
python scripts/build_games.py                                           # rank every game with play-by-play -> data/source/games_ranked.csv (~5 min)
python scripts/fetch_game_stories.py                                     # Wikipedia game summaries -> data/source/game_stories.json
python scripts/fetch_videos.py                                          # a YouTube video per game -> data/source/game_videos.csv
python scripts/fetch_player_media.py --photos --videos                  # player photos + highlight/interview videos -> data/source/player_media.json
python scripts/fetch_parks.py                                           # a photo + dimensions diagram per home park -> docs/parks/, docs/data/parks.json
python scripts/fetch_execs.py                                           # owners and general managers (Wikipedia) -> data/source/executives.json
python scripts/build_data.py                                            # rebuild with all of the above
```

- **Your list** comes from the IN, Year-by-Year Top 5, Parks R/L and Checklist tabs. Only the IN columns the site uses are exported. Season rankings come from the rating model; the Year-by-Year tab now supplies only the cWPA leader.
- **Your rating model** comes from `~/Documents/Baseball Ratings 2023.R` (pass another path to use a different version). `export_ratings.R` runs it unchanged up to the Hall of Fame models and saves every player-season's rating, year rank and tools, plus each player's peak-weighted rating and Hall odds. The site shows them as a career arc, 20-80 tools and the model's rank on player pages, the model's best five on team pages, and its top 10 on year pages. Skip this step and the site builds without them.
- **Greatest games** are ranked by `build_games.py` with (Inn + 9+SS + SS − 1) × (0.4 + maxL³ + cWPA1·gLI²)² × lastL^0.5 × gLI (SS: lead changes over the whole game; 9+SS: from the 9th on), over every game Retrosheet has play-by-play for (1908 on, plus the postseason since 1903 and the Negro Leagues' playoffs), and the postseasons since from the MLB Stats API (`python scripts/fetch_mlbapi.py`, rerun after each game). Win probability comes from each season's own run scoring; gLI is how much the game moved the title odds: in the postseason from the series standing and rounds left, in the regular season from playing out the rest of the schedule from that day's standings under that year's playoff format. Games are keyed by Retrosheet game id (`#g-PIT196010130`). The script's docstring has the details.
- **Franchise pages** are one club in one city, plus the clubs joined to it: `data/overrides/franchise_pages.json` maps every team season to its page (or to none, when it only appears on its league page) and names each page. It came from the franchise workbench; edit it by hand to move a season or rename a page. Each page lists every home park (a park counts in a season when it held a quarter of the home games) with a Wikipedia photo and its dimensions diagram, or a field drawn from the infobox distances when there is no diagram; every manager (Lahman); and, for today's 30 clubs, the principal owners and general managers from Wikipedia's navigation boxes.
- **League pages** cover the AA, UA, Players' League, Federal League, both Negro National Leagues, the NAL, ECL and East-West League (from the team seasons), and Cuba, the Dominican Republic, Venezuela, Puerto Rico and Japan (`data/source/league_seasons.json`: the club census from Baseball-Reference, Seamheads and club histories, with the listed players on each club).
- **Everything else** (careers, birthplaces, teams, parks, managers, stats through 2025) comes from the Lahman database (SABR's 2025 release, fetched by `fetch_lahman.py`).
- **Hand fixes** live in `data/overrides/`:
  - `player_ids.csv`: force a player match (or `NONE` for players outside the database)
  - `manual_players.csv`: players outside the database (NPB, Cuba, Mexico...), with home clubs
  - `from_places.csv`: where a player is "from" when it shouldn't be his birthplace
  - `team_cities.csv`: locations for teams without a home-park record (mostly Negro League and Cuban clubs)
  - `team_colors.csv`: badge colors per franchise
  - `photo_titles.csv`: the Wikipedia article to use when the photo script picks the wrong person (`NONE` to skip)
  - `games.csv`: by game id, your label, description, the team a game is filed under (`tm`), the `great` pick, `drop=1` to leave a game off the list, and for games with no play-by-play (before 1908, the latest regular season) the formula's inputs (inn, ss9, ss, gli, maxl, lastl, cwpa1, wpa1, tie)
  - `game_videos.csv`: pin a game’s YouTube video by game id (`key,video,note`); an empty video hides the automatic pick
  - `park_names.csv`: historical park names by Retrosheet park ID and season range (`park,y0,y1,name`)
  - `rating_drops.csv`: a player-season to leave out of the model's ratings and rankings when bad source data broke it (`playerID,yearID,kind,note`, kind `H` or `P`)
  - `park_titles.csv`: the Wikipedia article (or a specific photo / diagram file) for a park the park script gets wrong; check `data/park_review.csv`
- **Logos**: see `docs/logos/README.md`.

Game pages show the result, series standing, batting and pitching lines, video, and a linked Wikipedia summary when one is available. Automatic video picks are screened for the season, game number, matchup, and embedding availability; YouTube availability can still change.

## Editing pages

Every page starts as a draft built from the data above. To edit, open `#r-tracker` on the site and paste a fine-grained token with access to only this repo and *Contents: Read and write* (once per browser). Visitors never see the editing tools.

- **Player pages** are a timeline: stories, paragraphs from the history doc, photos, video and the scouting card each sit at a year, with the career table running through the middle. While editing, each item can move earlier or later, be rewritten, get a new year or be removed, and new stories, paragraphs, photos and videos can be added.
- The first edit gives a page its own copy in `docs/data/pages.json`, which wins over the data from then on. Rerunning the fetch scripts never changes an edited page.
- **Lock page** marks it finished and hides the editing tools. Unlock to change it again.
- Edits save straight to `docs/data/pages.json` on `main` (a commit per save, bundled a couple of seconds apart), so the live site follows a minute or so later. Pull before working locally.
- The **Tracker** counts locked pages by type, has a Spin for each type, and lists every page. The header Spin picks any page that isn't locked.

## Layout

```
docs/            the website (index.html, app.js, style.css, data/, photos/, logos/, vendor/); data/pages.json holds page edits
scripts/         export_sheet.py, build_data.py, fetch_photos.py, fetch_logos.py, build_notes.py
data/source/     CSVs exported from your spreadsheet
data/overrides/  hand fixes
```
