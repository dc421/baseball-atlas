# Team logos

Drop image files here (PNG, SVG, JPG or WEBP), then rerun `python scripts/build_data.py` so the site knows they exist.
Any team without a logo shows a round badge in its colors with its initials.

**File names** decide which teams use a file. The part before the extension is a team code, optionally followed by the first year that logo was used:

| File | Used for |
|---|---|
| `BOS.png` | every Red Sox season (franchise code) |
| `NYY_1913.png` | Yankees seasons from 1913 on (until a later-dated file takes over) |
| `BSN.png` | Boston Beaneaters / Braves seasons (season team code) |
| `HG.png` | Homestead Grays |

Codes: the franchise code (`BOS`, `NYY`, `ATL`…) or the season's Baseball-Reference/Lahman team code (`BSN`, `NY1`, `BRO`…).
A season-code file beats a franchise-code file; among dated files, the latest year not after the season wins.
The codes for any team are shown on its badge on the map.
