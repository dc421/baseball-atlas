"""Fetch ballpark coordinates from the Wikipedia pages identified in parks.json."""
import json
from pathlib import Path
from fetch_photos import api

ROOT = Path(__file__).resolve().parent.parent
parks = json.loads((ROOT / 'docs/data/parks.json').read_text())
# Named parks on manually assembled team seasons do not always have a park ID.
extra = {
    'Polo Grounds IV': 'Polo Grounds', 'Comiskey Park I': 'Comiskey Park',
    'Shibe Park': 'Shibe Park', 'Dexter Park': 'Dexter Park (Queens)',
    'Blues Stadium': 'Municipal Stadium (Kansas City, Missouri)',
    'Pelican Stadium': 'Pelican Stadium', 'Hamtramck Stadium': 'Hamtramck Stadium',
    'Greenlee Field': 'Greenlee Field', 'Rickwood Field': 'Rickwood Field',
    'Ruppert Stadium': 'Ruppert Stadium', 'Griffith Stadium': 'Griffith Stadium',
    'Crosley Field': 'Crosley Field',
}
titles = sorted({p['page'] for p in parks.values() if p.get('page')} | set(extra.values()))
coords = {}
for i in range(0, len(titles), 40):
    result = api(action='query', titles='|'.join(titles[i:i + 40]), redirects=1, prop='coordinates', colimit=500)
    redirects = {x['from']: x['to'] for x in result['query'].get('redirects', [])}
    normalized = {x['from']: x['to'] for x in result['query'].get('normalized', [])}
    pages = {p['title']: p for p in result['query']['pages']}
    for title in titles[i:i + 40]:
        key = normalized.get(title, title)
        key = redirects.get(key, key)
        c = pages.get(key, {}).get('coordinates', [])
        if c:
            coords[title] = [c[0]['lat'], c[0]['lon']]
output = {'ids': {k: coords[v['page']] for k, v in parks.items() if v.get('page') in coords},
          'names': {k: coords[v] for k, v in extra.items() if v in coords}}
(ROOT / 'docs/data/park_locations.json').write_text(json.dumps(output, indent=1) + '\n')
print(f"Found {len(output['ids'])} park IDs and {len(output['names'])} named parks")
