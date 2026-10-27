"""Build docs/data/atlas.json from your spreadsheet exports + the Lahman database.

Run from the repo root:  python scripts/build_data.py
Inputs:
  data/source/*.csv            exported from Baseball_Watch_List.numbers (see scripts/export_sheet.py)
  data/overrides/*.csv         hand fixes (player matches, "from" places)
  data/lahman/*.csv            Lahman database 2025 (1871-2025, incl. Negro Leagues): python scripts/fetch_lahman.py
  reverse_geocoder (pip)       city coordinates
Output:
  docs/data/atlas.json
"""
import csv, json, math, re, unicodedata, importlib.util
from pathlib import Path
import numpy as np, pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'data' / 'source'
OVR = ROOT / 'data' / 'overrides'
OUT = ROOT / 'docs' / 'data'
LAH = ROOT / 'data' / 'lahman'
RGF = Path(importlib.util.find_spec('reverse_geocoder').submodule_search_locations[0]) / 'rg_cities1000.csv'

if not (LAH / 'People.csv').exists(): raise SystemExit('No Lahman data: run python scripts/fetch_lahman.py first')


def rd(n):
    d = pd.read_csv(LAH / f'{n}.csv', encoding='utf-8-sig', low_memory=False).rename(columns={'IPouts': 'IPOuts'})
    for c in d.columns:  # whole-number columns with blanks: keep them whole (Int64), not 3.0
        if d[c].dtype == float and d[c].dropna().mod(1).eq(0).all(): d[c] = d[c].astype('Int64')
    return d


P, A, T, H, PK, TF, BAT, PIT = [rd(n) for n in ['People', 'Appearances', 'Teams', 'HomeGames', 'Parks', 'TeamsFranchises', 'Batting', 'Pitching']]
BAT = BAT.fillna(0); PIT = PIT.fillna(0)
# one person split across two People rows (same bbrefID, e.g. Chino Smith's career sits under "Charlie Smith"):
# file the appearances and stats under the row whose playerID is the bbrefID
_dup = P[P.bbrefID.notna()].groupby('bbrefID').playerID.apply(list)
SAME = {i: b for b, ids in _dup[_dup.map(len) > 1].items() if b in ids for i in ids if i != b}
for d in (A, BAT, PIT): d['playerID'] = d.playerID.replace(SAME)
PK = PK.astype(object).where(PK.notna(), None)


def norm(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z]', '', s)


def nz(v):
    if v is None: return None
    try:
        if pd.isna(v): return None
    except (TypeError, ValueError): pass
    if isinstance(v, np.integer): return int(v)
    if isinstance(v, np.floating): return float(v)
    return v


# ---------------------------------------------------------------- places
ST = {'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado','CT':'Connecticut','DE':'Delaware','DC':'District of Columbia','FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming'}
PROVINCES = {'ON':'Ontario','QC':'Quebec','BC':'British Columbia','AB':'Alberta','MB':'Manitoba','SK':'Saskatchewan','NS':'Nova Scotia','NB':'New Brunswick','PE':'Prince Edward Island','NL':'Newfoundland and Labrador'}
CC = {'USA':'US','US':'US','D.R.':'DO','P.R.':'PR','PR':'PR','Cuba':'CU','Venezuela':'VE','CAN':'CA','CA':'CA','Mexico':'MX','México':'MX','MX':'MX','Panama':'PA','CZ':'PA','Japan':'JP','JP':'JP','Netherlands':'NL','Curacao':'CW','Curaçao':'CW','Aruba':'AW','Colombia':'CO','Nicaragua':'NI','Germany':'DE','Ireland':'IE','United Kingdom':'GB','UK':'GB','Australia':'AU','AU':'AU','South Korea':'KR','KR':'KR','Taiwan':'TW','V.I.':'VI','Bahamas':'BS','Jamaica':'JM','Brazil':'BR','Honduras':'HN','Scotland':'GB','Wales':'GB','England':'GB','France':'FR','Italy':'IT','Russia':'RU','Czech Republic':'CZ','Poland':'PL','Norway':'NO','Sweden':'SE','Austria':'AT','Spain':'ES','Belgium':'BE','Denmark':'DK','China':'CN','Philippines':'PH','Guam':'GU','Peru':'PE','Belize':'BZ','Greece':'GR','Lithuania':'LT','Latvia':'LV','Finland':'FI','Switzerland':'CH','Portugal':'PT','American Samoa':'AS','Hong Kong':'HK','Indonesia':'ID','Israel':'IL','South Africa':'ZA','Hungary':'HU','Slovakia':'SK','Ukraine':'UA'}
COUNTRY = {'US':'United States','DO':'Dominican Republic','PR':'Puerto Rico','CU':'Cuba','VE':'Venezuela','CA':'Canada','MX':'Mexico','PA':'Panama','JP':'Japan','NL':'Netherlands','CW':'Curaçao','AW':'Aruba','CO':'Colombia','NI':'Nicaragua','DE':'Germany','IE':'Ireland','GB':'United Kingdom','AU':'Australia','KR':'South Korea','TW':'Taiwan','VI':'U.S. Virgin Islands','BS':'Bahamas','JM':'Jamaica','BR':'Brazil','HN':'Honduras','FR':'France','IT':'Italy','RU':'Russia','CZ':'Czechia','PL':'Poland','NO':'Norway','SE':'Sweden','AT':'Austria','ES':'Spain','BE':'Belgium','DK':'Denmark','CN':'China','PH':'Philippines','GU':'Guam','PE':'Peru','BZ':'Belize','GR':'Greece','LT':'Lithuania','LV':'Latvia','FI':'Finland','CH':'Switzerland','PT':'Portugal','AS':'American Samoa','HK':'Hong Kong','ID':'Indonesia','IL':'Israel','ZA':'South Africa','HU':'Hungary','SK':'Slovakia','UA':'Ukraine'}

RG = pd.read_csv(RGF)
RG['nn'] = RG.name.map(norm); RG['na'] = RG.admin1.fillna('').map(norm)
g3, g2, ADM = {}, {}, {}
for la, lo, nn, na, cc, a1 in zip(RG.lat, RG.lon, RG.nn, RG.na, RG.cc, RG.admin1):
    ll = (round(la, 3), round(lo, 3))
    g3.setdefault((nn, cc, na), ll)
    g2.setdefault((nn, cc), (ll, a1))
    a = ADM.setdefault((cc, na), [0, 0, 0]); a[0] += la; a[1] += lo; a[2] += 1


def region_name(state, cc):
    if not state: return None
    s = str(state)
    if cc == 'US': return ST.get(s, s)
    if cc == 'CA': return PROVINCES.get(s, s)
    return s


def geocode(city, state, country):
    """-> (place dict {c,r,n}, [lat,lon] or None, approx flag)"""
    cc = CC.get(str(country).strip()) if country else None
    if not cc: return None, None, 0
    reg = region_name(state, cc)
    place = {'c': city or None, 'r': reg if cc not in ('PR', 'VI') else None, 'n': COUNTRY.get(cc, cc)}
    if not city:
        a = ADM.get((cc, norm(reg or '')))
        return place, ([round(a[0] / a[2], 3), round(a[1] / a[2], 3)] if a else None), 1
    c = norm(city); sn = norm(reg or '')
    if cc == 'US':
        if c == 'newyork' and sn == 'newyork': return place, [40.713, -74.006], 0
        if sn == 'districtofcolumbia' or (c == 'washington' and state == 'DC'): return place, [38.895, -77.037], 0
        for k in [(c, cc, sn), (c.replace('st', 'saint', 1), cc, sn), (c.replace('ft', 'fort', 1), cc, sn), (c + 'city', cc, sn)]:
            if k in g3: return place, list(g3[k]), 0
    hit = g2.get((c, cc)) or g2.get((c.replace('county', ''), cc))
    if hit:
        if not place['r'] and cc not in ('PR', 'VI') and isinstance(hit[1], str): place['r'] = hit[1]
        return place, list(hit[0]), 0 if cc != 'US' else 1
    a = ADM.get((cc, sn))
    if a: return place, [round(a[0] / a[2], 3), round(a[1] / a[2], 3)], 1
    return place, None, 0


# ---------------------------------------------------------------- your list
IN = pd.read_csv(SRC / 'IN.csv')
IN = IN[IN.Last.notna()].reset_index(drop=True)
P = P.astype(object).where(P.notna(), None)
yrs = A.groupby('playerID').agg(y0=('yearID', 'min'), y1=('yearID', 'max'), G=('G_all', 'sum')).reset_index()
PM = P.merge(yrs, on='playerID', how='left')
PM['nf'] = PM.nameFirst.map(norm); PM['nl'] = PM.nameLast.map(norm); PM['ng'] = PM.nameGiven.map(lambda s: norm(s or ''))

ovr_match = {}
if (OVR / 'player_ids.csv').exists():
    for r in pd.read_csv(OVR / 'player_ids.csv').itertuples():
        ovr_match[(r.First, r.Last)] = None if str(r.playerID) in ('', 'nan', 'NONE') else r.playerID


def match_player(first, last, peak):
    if (first, last) in ovr_match: return ovr_match[(first, last)]
    f, l = norm(first), norm(last)
    c = PM[(PM.nl == l) & ((PM.nf == f) | PM.ng.str.contains(f))]
    if len(c) == 0: c = PM[PM.nl == l]
    c = c[(c.y0 <= peak + 2) & (c.y1 >= peak - 2)]
    if len(c) > 1: c = c.sort_values('G', ascending=False).head(1)
    return c.playerID.iloc[0] if len(c) == 1 else None


# players outside the database (NPB, Cuban leagues, Mexican League...)
MANUAL = {r.key: r for r in pd.read_csv(OVR / 'manual_players.csv').itertuples()} if (OVR / 'manual_players.csv').exists() else {}
FROM_FIX = {r.key: r for r in pd.read_csv(OVR / 'from_places.csv').itertuples()} if (OVR / 'from_places.csv').exists() else {}

# ---------------------------------------------------------------- teams
TFn = dict(zip(TF.franchID, TF.franchName))
H2 = H.sort_values('games', ascending=False).drop_duplicates(['yearkey', 'teamkey'])
hg = {(y, t): p for y, t, p in zip(H2.yearkey, H2.teamkey, H2.parkkey)}
PKd = {r.parkkey: r for r in PK.itertuples()}
park_geo = {r.parkkey: geocode(r.city, r.state, r.country) for r in PK.itertuples()}
TEAM_CITY = pd.read_csv(OVR / 'team_cities.csv')  # team-name prefix -> city, region, country, lat, lon
TEAM_CITY = sorted(TEAM_CITY.itertuples(), key=lambda r: -len(r.prefix))


def team_city(name):
    for r in TEAM_CITY:
        if name.startswith(r.prefix):
            return {'c': r.city, 'r': None if pd.isna(r.region) else r.region, 'n': r.country}, [r.lat, r.lon]
    return None, None


T = T.sort_values(['yearID', 'lgID', 'teamID'])
T = T.astype(object).where(T.notna(), None)
teams, tkey, retro_of = {}, {}, {}
for r in T.itertuples():
    pk = hg.get((r.yearID, r.teamIDretro)) or hg.get((r.yearID, r.teamID))
    place, ll, ap = (park_geo.get(pk) or (None, None, 0)) if pk else (None, None, 0)
    if ll is None:
        place, ll = team_city(r.name); ap = 1
    tid = f'{r.teamID}-{r.yearID}'
    tkey[(r.teamID, r.yearID)] = tid
    retro_of[tid] = r.teamIDretro or r.teamID
    lg = r.lgID or ('NA' if r.yearID <= 1875 else None)
    teams[tid] = dict(y=int(r.yearID), lg=lg, tm=r.teamID, fr=r.franchID, n=r.name, w=nz(r.W), l=nz(r.L), rs=nz(r.R), ra=nz(r.RA), rk=nz(r.Rank),
                      pen=1 if r.LgWin == 'Y' else 0, ws=1 if r.WSWin == 'Y' else 0, dv=nz(r.divID), pk=pk, park=nz(r.park),
                      br=nz(r.teamIDBR), ll=ll, pl=place, ap=ap)
print('team seasons', len(teams), '| without a location:', sorted({t['n'] for t in teams.values() if not t['ll']}))

# franchise colors: data/overrides/team_colors.csv (franchID, bg, fg); others get a neutral badge
COLORS = {r.franchID: [r.bg, r.fg] for r in pd.read_csv(OVR / 'team_colors.csv').itertuples()}
# teams the database doesn't carry (data/overrides/manual_teams.csv): the 1869 Cincinnati Red Stockings (a tracked season,
# top=1) and clubs only Baseball-Reference's Black Baseball register knows (the 25th Infantry Wreckers, the 1935 Bismarck
# club). ro: the list's players on the team, space-separated keys
MANUAL_RO = {}
for r in pd.read_csv(OVR / 'manual_teams.csv', dtype=str).fillna('').itertuples() if (OVR / 'manual_teams.csv').exists() else []:
    teams[r.tid] = dict(y=int(r.y), lg=r.lg, tm=r.tm, fr=r.fr, n=r.n, w=int(r.w) if r.w else None, l=int(r.l) if r.l else None, rs=None, ra=None, rk=None,
                        pen=0, ws=0, dv=None, pk=None, park=r.park or None, br=None, ll=[float(r.lat), float(r.lon)],
                        pl={'c': r.city, 'r': r.region or None, 'n': r.country}, ap=0, **({'top': 1} if r.top == '1' else {}))
    TFn[r.fr] = r.franch; COLORS[r.fr] = [r.bg, r.fg]
    if r.ro: MANUAL_RO[r.tid] = r.ro.split()
# franchise pages: Lahman's franchises regrouped by city (data/overrides/franchise_pages.json, from the franchise
# workbench). A page is one club in one city plus the clubs joined to it; each team season gets its page as 'fp'
# ('fr' stays Lahman's franchise, for logos and colors). A season on no page shows on its league page, if it has one.
# Seasons added since the export go to the page of their franchise's latest season.
FP = json.load(open(OVR / 'franchise_pages.json'))
fr_page = {}
for tid in sorted(teams, key=lambda x: teams[x]['y']):
    if FP['teams'].get(tid): fr_page[teams[tid]['fr']] = FP['teams'][tid]
franch = {}
for tid in sorted(teams, key=lambda x: (teams[x]['y'], x)):
    t = teams[tid]; k = t['fp'] = FP['teams'][tid] if tid in FP['teams'] else fr_page.get(t['fr'])
    if not k: continue
    code = FP['pages'][k]['root'].split(':')[1]
    franch.setdefault(k, dict(n=FP['pages'][k]['n'], s=[], col=COLORS.get(code) or COLORS.get(t['fr'])))['s'].append(tid)

# parks (shown on team pages)
parks = {}
for pk, grp in H.groupby('parkkey'):
    r = PKd.get(pk)
    if r is None: continue
    parks[pk] = dict(n=r.parkname, al=nz(r.parkalias), c=r.city, st=nz(r.state), y0=int(grp.yearkey.min()), y1=int(grp.yearkey.max()))
pn = pd.read_csv(SRC / 'Parks_R-L.csv', header=None).fillna('')
for row in pn.values[1:]:
    yrs_, tm, nm, lgnote, lean = [str(x).strip() for x in row[:5]]
    if not nm: continue
    cands = [pk for pk, p in parks.items() if nm.lower().replace('’', "'") in (p['n'] + ';' + (p['al'] or '')).lower().replace('’', "'")]
    if cands:
        best = cands[0]
        note = f"{yrs_} {tm}: " + (f"plays toward {lean}. " if lean else '') + (lgnote and f"({lgnote})")
        hl = row[5:9]
        if any(str(x) for x in hl): note += f" L home {hl[0]}, L road {hl[1]}, R home {hl[2]}, R road {hl[3]}"
        parks[best]['note'] = (parks[best].get('note', '') + ' ' + note).strip()

# each franchise's home parks, as runs of seasons: a park counts in a season when it held a quarter of the home games
# (keeps out one-off neutral sites). Seasons with no HomeGames rows (Negro Leagues...) use the park named in Teams,
# matched to a database park in the same city when there is one ('x...' keys otherwise; scripts/fetch_parks.py finds photos)
fr_of = {(r.yearID, r.teamIDretro or r.teamID): r.franchID for r in T.itertuples()}
home, have_hg = {}, set()
for r, tot in zip(H.itertuples(), H.groupby(['yearkey', 'teamkey']).games.transform('sum')):
    fr = fr_of.get((r.yearkey, r.teamkey))
    if fr is None: continue
    have_hg.add((fr, int(r.yearkey)))
    if r.parkkey in parks and r.games >= 0.25 * tot: home.setdefault(fr, {}).setdefault(r.parkkey, set()).add(int(r.yearkey))
by_name = {}
for pk, p in parks.items():
    for nm in [p['n']] + (p['al'] or '').split(';'):
        if nm.strip(): by_name.setdefault((norm(nm), norm(p['c'])), pk)
for t in teams.values():
    if (t['fr'], t['y']) in have_hg or not t['park']: continue
    city = (t['pl'] or {}).get('c') or ''
    pk = by_name.get((norm(t['park']), norm(city))) or 'x' + re.sub(r'[^A-Za-z0-9]', '', unicodedata.normalize('NFKD', t['park'] + city).encode('ascii', 'ignore').decode())
    if pk not in parks: parks[pk] = dict(n=t['park'], al=None, c=city, st=(t['pl'] or {}).get('r'), y0=t['y'], y1=t['y'])
    p = parks[pk]; p['y0'], p['y1'] = min(p['y0'], t['y']), max(p['y1'], t['y'])
    home.setdefault(t['fr'], {}).setdefault(pk, set()).add(t['y'])
page_home = {}  # each page's parks: its seasons' years in their Lahman franchise's parks
for k, f in franch.items():
    for tid in f['s']:
        t = teams[tid]
        for pk, ys in home.get(t['fr'], {}).items():
            if t['y'] in ys: page_home.setdefault(k, {}).setdefault(pk, set()).add(t['y'])
for fr, ps in page_home.items():
    runs = []
    for pk, ys in ps.items():
        sp = []
        for y in sorted(ys):
            if sp and y == sp[-1][1] + 1: sp[-1][1] = y
            else: sp.append([y, y])
        runs.append([pk, sp])
    franch[fr]['pk'] = sorted(runs, key=lambda x: x[1][0])

# ---------------------------------------------------------------- players
Pi = P.set_index('playerID')
A2 = A.merge(T[['yearID', 'teamID', 'franchID', 'name']], on=['yearID', 'teamID'], how='left')
apps = {pid: g for pid, g in A2.groupby('playerID')}
bat = BAT.groupby('playerID')[['G', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'BB', 'SO', 'HBP', 'SF']].sum()
pit = PIT.groupby('playerID')[['W', 'L', 'G', 'GS', 'SV', 'IPOuts', 'H', 'ER', 'BB', 'SO', 'HR']].sum()
f3 = lambda x: ('%.3f' % x).lstrip('0') if x == x else ''
players, roster = {}, {}
for j, r in IN.iterrows():
    first, last = str(r.First), str(r.Last)
    peak = int(r.Peak) if r.Peak == r.Peak else 0
    pid = match_player(first, last, peak)
    key = pid if pid else 'x' + norm(last)[:5] + norm(first)[:2]
    prk = nz(r.PosRk)
    base = {d: 1 for c, d in [('Vid', 'video'), ('SABR', 'sabr'), ('Int', 'interview')] if str(r[c]).strip() == 'Y'}
    if str(r.Bio).strip() == 'Y': base['book'] = 1
    o = dict(f=first, l=last, pos=str(r.POS), pk=peak or None, ovr=int(r.OVR) if r.OVR == r.OVR else None,
             prk=int(float(prk)) if re.match(r'^[0-9.]+$', str(prk)) else prk, base=base,
             have=None if str(r.Have) == 'nan' else r.Have)
    if pid:
        p = Pi.loc[pid]
        o['id'] = pid; o['br'] = nz(p.bbrefID)
        place, ll, ap = geocode(p.birthCity, p.birthState, p.birthCountry)
        o['born'] = '-'.join(str(int(x)).zfill(2) for x in [p.birthYear, p.birthMonth, p.birthDay] if x) if p.birthYear else None
        o['bplace'] = ', '.join(x for x in [place and place['c'], place and place['r'], place and place['n'] != 'United States' and place['n']] if x) if place else None
        o['died'] = '-'.join(str(int(x)).zfill(2) for x in [p.deathYear, p.deathMonth, p.deathDay] if x) if p.deathYear else None
        o['ht'] = nz(p.height); o['wt'] = nz(p.weight); o['bt'] = f"{p.bats or '?'}/{p.throws or '?'}"
        o['from'] = place; o['ll'] = ll
        if ap: o['llap'] = 1
        st = []
        g = apps.get(pid)
        if g is not None:
            for y, yy in g.sort_values(['yearID', 'G_all'], ascending=[True, False]).groupby('yearID'):
                for t in yy.itertuples():
                    tid = tkey.get((t.teamID, int(y)))
                    if tid: roster.setdefault(tid, []).append(key)
                    if st and st[-1][0] == t.franchID and st[-1][3] >= y - 1:
                        st[-1][3] = int(y); st[-1][4] += int(t.G_all or 0)
                    else:
                        st.append([t.franchID, t.name, int(y), int(y), int(t.G_all or 0), tid])
        o['st'] = st
        if pid in bat.index and bat.loc[pid, 'AB'] > 0:
            b = bat.loc[pid]; pa = b.AB + b.BB + b.HBP + b.SF; tb = b.H + b['2B'] + 2 * b['3B'] + 3 * b.HR
            o['bat'] = dict(G=int(b.G), AB=int(b.AB), H=int(b.H), HR=int(b.HR), R=int(b.R), RBI=int(b.RBI), SB=int(b.SB), BB=int(b.BB),
                            AVG=f3(b.H / b.AB), OBP=f3((b.H + b.BB + b.HBP) / pa) if pa else '', SLG=f3(tb / b.AB))
        if pid in pit.index and pit.loc[pid, 'IPOuts'] > 0:
            q = pit.loc[pid]; ip = q.IPOuts / 3
            o['pit'] = dict(W=int(q.W), L=int(q.L), G=int(q.G), GS=int(q.GS), SV=int(q.SV),
                            IP=f"{int(q.IPOuts // 3)}{'.' + str(int(q.IPOuts % 3)) if q.IPOuts % 3 else ''}",
                            SO=int(q.SO), BB=int(q.BB), ERA='%.2f' % (9 * q.ER / ip) if ip else '')
    elif key in MANUAL:
        m = MANUAL[key]
        o.update(born=str(m.born), bplace=m.bplace, ll=[m.lat, m.lon], **{'from': {'c': m.city, 'r': None if pd.isna(m.region) else m.region, 'n': m.country}})
        o['clubs'] = [c.split('@') for c in str(m.clubs).split(';')] if str(m.clubs) != 'nan' else []
    else:
        print('  no match and no manual entry:', first, last)
    if key in FROM_FIX:
        f = FROM_FIX[key]
        o['from'] = {'c': f.city, 'r': None if pd.isna(f.region) else f.region, 'n': f.country}; o['ll'] = [f.lat, f.lon]; o.pop('llap', None)
    players[key] = o

print('players', len(players), '| no "from" location:', [f"{o['f']} {o['l']}" for o in players.values() if not o.get('ll')])

# ---------------------------------------------------------------- cWPA leader by year (Year-by-Year Top 5 tab)
top = pd.read_csv(SRC / 'Year-by-Year_Top_5.csv').fillna('')
cellre = re.compile(r'^(?:(C|1B|2B|3B|SS|LF|CF|RF|DH|OF|P|UT)\s+)?(.+?)\s*\(([^)]*)\)\s*$')
by_name = {norm(o['f'] + o['l']): k for k, o in players.items()}
years = {}
for r in top.itertuples(index=False):
    try: y = int(float(r[0]))
    except ValueError: continue
    ent = []
    cell = str(r[12]).strip()  # the cWPA leader; the year's top 5s come from the model below
    if cell:
        m = cellre.match(cell)
        pos, nm, tm = (m.group(1), m.group(2), m.group(3)) if m else (None, cell, '')
        ent.append(['WPA', 1, pos, nm, tm, by_name.get(norm(nm))])
    years[y] = dict(top=ent)

# ---------------------------------------------------------------- era notes (Checklist tab)
ck = pd.read_csv(SRC / 'Checklist.csv', header=None).fillna('')
eras = []
for row in ck.values[19:]:
    a = str(row[0]).strip().replace('.0', '')
    m = re.match(r'^(\d{4})(?:-(\d{1,2}))?$', a)
    if not m: continue
    y0 = int(m.group(1)); y1 = y0
    if m.group(2):
        s = m.group(2); y1 = int(str(y0)[:4 - len(s)] + s)
        if y1 < y0: y1 += 100
    eras.append([y0, y1, str(row[1]).strip(), str(row[2]).strip()])

# ---------------------------------------------------------------- games
gm = pd.read_csv(SRC / 'Games.csv').fillna('')
brmap = {}
for tid, t in teams.items():
    if t['br']: brmap[(t['br'], t['y'])] = tid
    brmap.setdefault((t['fr'], t['y']), tid)
BRFIX = {'MIL': 'MLN', 'MIA': 'FLA', 'WAS': 'WSH', 'LAA': 'ANA', 'TBR': 'TBD', 'MWB': 'MLN', 'BSB': 'BSN', 'BRK': 'BRO'}
fl = lambda x: round(float(x), 3) if str(x).strip() not in ('',) else None
games, rowi = {}, 0
for r in gm.itertuples(index=False):
    try: y = int(float(r[1]))
    except ValueError: continue
    rowi += 1
    try: rk = int(float(r[0]))
    except ValueError: rk = rowi
    code = str(r[13]).strip()
    tid = (brmap.get((code, y)) or brmap.get((BRFIX.get(code, code), y))) if code else None
    if code and not tid: tid = brmap.get(('WSN' if code == 'WAS' else code, y))
    games[str(rk)] = dict(rk=rk, y=y, g=str(r[2]).strip(), inn=fl(r[3]), d=str(r[12]).strip(), sc=fl(r[11]), cw=fl(r[8]), wpa=fl(r[9]), li=fl(r[5]),
                          tm=code or None, tid=tid, gr=1 if str(r[24]).strip() == 'great' else 0)
    years.setdefault(y, {}).setdefault('games', []).append(str(rk))

# ---------------------------------------------------------------- your rating model (scripts/export_ratings.R)
# One rating everywhere: projected WAR per 150 games. The model's score is WAR/G above its era line (pitchers on the
# hitter scale); adding back today's line (.0346) makes it plain projected WAR per 150 for anyone since the war, while
# earlier seasons keep the model's era adjustment. Hall thresholds on this scale: all-timer > 6.2, safely in > 5.6,
# borderline in > 5.2, borderline out > 4.7.
W150 = lambda s: np.round((s + .0346) * 150, 1)
season_score = {}  # (key, year) -> rating, for sorting rosters
rating_of = {}  # (playerID, year) -> rating, shown on team pages
if (SRC / 'ratings_seasons.csv').exists() and (SRC / 'ratings_players.csv').exists():
    RS = pd.read_csv(SRC / 'ratings_seasons.csv')
    RP = pd.read_csv(SRC / 'ratings_players.csv')
    RS = RS[np.isfinite(RS.score)].sort_values('score', ascending=False).drop_duplicates(['playerID', 'yearID', 'kind']).copy()
    # hand-dropped seasons where bad source data broke the model (data/overrides/rating_drops.csv); the rest of
    # that year's ranks close up behind them
    if (OVR / 'rating_drops.csv').exists():
        drop = {(r.playerID, int(r.yearID), r.kind) for r in pd.read_csv(OVR / 'rating_drops.csv').itertuples()}
        RS = RS[[(p, y, kd) not in drop for p, y, kd in zip(RS.playerID, RS.yearID, RS.kind)]].copy()
        RS['year_rank'] = RS.groupby(['yearID', 'kind']).year_rank.rank(method='first').astype(int)
    RS['s'] = W150(RS.score)
    rating_of = RS.groupby(['playerID', 'yearID']).s.max().to_dict()
    # list players: by Lahman id, else by name for the ones outside the database
    pid2key = {o['id']: k for k, o in players.items() if o.get('id')}
    nm = RS.groupby('playerID').name.first().dropna()
    by_nm = nm.groupby(nm.map(norm)).apply(lambda s: s.index[0] if len(s) == 1 else None).dropna()
    for k, o in players.items():  # also when the sheet files a Negro leaguer under its own id (smithch99 for smithch11)
        if (not o.get('id') or o['id'] not in nm.index) and norm(o['f'] + o['l']) in by_nm.index: pid2key[by_nm[norm(o['f'] + o['l'])]] = k
    RS['key'] = RS.playerID.map(pid2key)

    # tools on a 20-80 scale: z-score among regular seasons, then the player's top 4 rated seasons
    tools = {'H': ['hit_tool', 'power', 'speed', 'fielding'], 'P': ['K_plus', 'BB_plus', 'dur']}
    RS['dur'] = RS.BFP  # durability: batters faced per season, graded within SP or RP below
    for kind, cols in tools.items():
        reg = RS[(RS.kind == kind) & ((RS.PA >= 300) if kind == 'H' else (RS.BFP >= 300))]
        for c in cols:
            if c == 'dur':
                grp = RS.POS.where(RS.POS == 'RP', 'SP')
                m, sd = reg.groupby(grp[reg.index]).dur.agg(['mean', 'std']).reindex(grp).values.T
                RS['dur_g'] = (50 + 10 * (RS.dur - m) / sd).clip(20, 80).where(RS.kind == 'P')
                continue
            z = (RS[c] - reg[c].mean()) / reg[c].std()
            RS[c + '_g'] = (50 + 10 * (-z if c == 'BB_plus' else z)).clip(20, 80)
    mine = RS[RS.key.notna()]
    for k, g in mine.groupby('key'):
        o = players[k]
        o['arc'] = [[int(r.yearID), float(r.s), int(r.year_rank), r.kind] for r in g.sort_values('yearID').itertuples()]
        for r in g.itertuples(): season_score[(k, int(r.yearID))] = max(season_score.get((k, int(r.yearID)), -99), r.s)
        kind = 'P' if o['pos'] in ('SP', 'RP') and (g.kind == 'P').any() else 'H'
        best = g[g.kind == kind].nlargest(4, 's')
        w = (best.PA if kind == 'H' else best.BFP).fillna(1).clip(lower=1)
        ok = {c: best[c + '_g'].notna() for c in tools[kind]}
        o['tools'] = {c: int(round(np.average(best[c + '_g'][ok[c]], weights=w[ok[c]]) / 5) * 5) for c in tools[kind] if ok[c].any()}
    for r in RP.itertuples():
        k = pid2key.get(r.playerID)
        if not k: continue
        players[k]["mr"] = dict(r=float(np.round((r.rating + .0346) * 150, 2)), rk=int(r.rk_ovr), prk=int(r.pos_rk), pos=r.POS, pk=int(r.peak_year),
                                war=nz(r.WAR), hof=1 if str(r.hof).upper() == 'TRUE' else 0, odds=round(r.should_hof_pred, 3))
    # relievers are rated by rate, as in your script's RP list: proj_WAR_BFP_net, best four seasons weighted 2/1.5/1/.5
    rel = RS[(RS.kind == 'P') & (RS.POS == 'RP') & RS.rp_score.notna()].copy()
    rel['rs'] = (rel.rp_score * 1000).round(2)
    rel['rrk'] = rel.groupby('yearID').rs.rank(ascending=False, method='min').astype(int)
    wts = np.array([2, 1.5, 1, .5])
    career = rel.groupby('playerID').rs.apply(lambda x: float(np.dot(np.pad(np.sort(x.values)[::-1][:4], (0, max(0, 4 - len(x))), constant_values=-10), wts) / 5))
    crk = career.rank(ascending=False, method='min').astype(int)
    for k, o in players.items():
        g = rel[rel.key == k]
        if o['pos'] != 'RP' or g.empty: continue
        pid = g.playerID.iloc[0]
        o['arc'] = [[int(r.yearID), float(r.rs), int(r.rrk), 'R'] for r in g.sort_values('yearID').itertuples()]
        o['mr'] = dict(o.get('mr') or {}, r=round(career[pid], 2), rk=int(crk[pid]), prk=int(crk[pid]), pos='RP', rel=1,
                       pk=int(g.loc[g.rs.idxmax(), 'yearID']))

    # which team seasons each player-season belongs to (for the year pages' model lists)
    app_t = {}
    for r in A[['playerID', 'yearID', 'teamID']].itertuples(index=False):
        tid = tkey.get((r.teamID, int(r.yearID)))
        if tid: app_t.setdefault((r.playerID, int(r.yearID)), []).append(tid)

    # each year's top 10 hitters and pitchers, plus the top reliever by rate
    for (y, kind), g in RS.groupby(['yearID', 'kind']):
        g = g.nsmallest(10, 'year_rank')
        years.setdefault(int(y), {})['m' + kind] = [[r.name, r.key if isinstance(r.key, str) else None, float(r.s), r.POS,
                                                     (app_t.get((r.playerID, int(y))) or [None])[0], 'war' if r.G < 1 else ''] for r in g.itertuples()]
    for y, g in RS[(RS.kind == 'P') & (RS.POS == 'RP')].groupby('yearID'):
        r = g.nlargest(1, 'rp_score').iloc[0]
        years[int(y)]['mRP'] = [r['name'], r.key if isinstance(r.key, str) else None, round(r.rp_score * 1000, 2), 'RP',
                                (app_t.get((r.playerID, int(y))) or [None])[0]]
    # team ratings: each player's projected WAR/G, weighted by games for that team, summed, per 162,
    # then against smooth curves over time (the projections already handle era and wartime talent)
    AP = A[['playerID', 'yearID', 'teamID', 'G_all', 'G_p']].fillna(0)
    tw = RS[['playerID', 'yearID', 'kind', 'name', 'key', 'POS', 'proj_WAR_G']].merge(AP, on=['playerID', 'yearID'])
    tw['tid'] = [tkey.get((t, int(y))) for t, y in zip(tw.teamID, tw.yearID)]
    tw['g'] = np.where(tw.kind == 'P', tw.G_p, tw.G_all)
    tw = tw[tw.tid.notna() & (tw.g > 0)].copy()
    # the pitcher model can blow up on a one-game cameo (a 2-batter start projects at -262 WAR/G), so keep each
    # projection inside the range seen among regulars (hitters 10+ G, pitchers 100+ BFP)
    reg = RS[np.where(RS.kind == 'P', RS.BFP >= 100, RS.G >= 10)].groupby('kind').proj_WAR_G.agg(['min', 'max'])
    tw['proj_WAR_G'] = tw.proj_WAR_G.clip(tw.kind.map(reg['min']), tw.kind.map(reg['max']))
    tw['war'] = tw.proj_WAR_G * tw.g
    tr = {}
    for tid, g in tw.groupby('tid'):
        t = teams[tid]; gp = (t['w'] or 0) + (t['l'] or 0)
        if gp < 20 or g[g.kind == 'H'].g.sum() < 4 * gp: continue  # a handful of games, or under half the lineup matched: unrated
        k = 162 / gp
        top = g.nlargest(3, 'war')
        tr[tid] = dict(v=round(g.war.sum() * k, 1), h=round(g[g.kind == 'H'].war.sum() * k, 1), p=round(g[g.kind == 'P'].war.sum() * k, 1),
                       top=[[r.name, r.key if isinstance(r.key, str) else None, rating_of.get((r.playerID, r.yearID))] for r in top.itertuples()])
    TR = pd.DataFrame([dict(tid=tid, y=teams[tid]['y'], lg=teams[tid]['lg'], v=o['v'], w=teams[tid]['w'], l=teams[tid]['l'],
                            rs=teams[tid]['rs'], ra=teams[tid]['ra']) for tid, o in tr.items()]).astype({'rs': float, 'ra': float})
    # score, in wins above an average team per 162: 80% talent (WAR sum vs. a cubic curve of typical team WAR over
    # time), 15% Pythagorean record (exp 1.83), 5% actual record. Records are shrunk toward .500 for short seasons:
    # x G/(G+70), relative to a 162-game season. Each part is then scaled by a curve of how spread out teams were
    # (cubic in year on log RMS of the yearly gaps, rescaled to its median), since early leagues were far more lopsided
    x = (TR.y - 1950) / 50
    TR['tal'] = TR.v - np.polyval(np.polyfit(x, TR.v, 3), x)
    TR['wp'] = (TR.w / (TR.w + TR.l) - .5) * 162
    TR['py'] = ((TR.rs ** 1.83 / (TR.rs ** 1.83 + TR.ra ** 1.83)) - .5) * 162
    TR['py'] = TR.py.fillna(TR.wp)  # no runs recorded: lean on the record
    gp = TR.w + TR.l
    shrink = np.minimum(1, (gp / (gp + 70)) / (162 / (162 + 70)))
    TR['py'], TR['wp'] = TR.py * shrink, TR.wp * shrink
    for c in ['tal', 'py', 'wp']:
        yr = TR.groupby('y')[c].agg(rms=lambda r: np.sqrt((r ** 2).mean()), n='size').reset_index()
        spread = np.exp(np.polyval(np.polyfit((yr.y - 1950) / 50, np.log(yr.rms), 3, w=np.sqrt(yr.n)), x))
        TR[c] = TR[c] * np.median(spread) / spread
    TR['a'] = .80 * TR.tal + .15 * TR.py + .05 * TR.wp
    TR['yr'] = TR.groupby('y').a.rank(ascending=False, method='min').astype(int)
    TR['ar'] = TR.a.rank(ascending=False, method='min').astype(int)
    # tracked team seasons: one per season played since 1869 in total (the 1869 Red Stockings plus the best by all-time
    # rank), so the list grows by one each new season
    n_track = len({t['y'] for t in teams.values()}) - sum(1 for t in teams.values() if t.get('top'))
    for tid in TR.nsmallest(n_track, 'ar').tid: teams[tid]['top'] = 1
    for r in TR.itertuples(): teams[r.tid]['tr'] = dict(tr[r.tid], a=round(r.a, 1), tal=round(r.tal, 1), py=round(r.py, 1), wp=round(r.wp, 1), yr=int(r.yr), ar=int(r.ar), n=int((TR.y == r.y).sum()))
    print(f'team ratings: {len(TR)} of {len(teams)} team seasons rated; best: ' +
          ', '.join(f"{teams[r.tid]['y']} {teams[r.tid]['n']} {r.a:+.1f}" for r in TR.nsmallest(5, 'ar').itertuples()))
    print(f'ratings: {len(RS)} seasons, {RS.key.notna().groupby(RS.playerID).any().sum()} of {len(players)} list players matched')
else:
    print('ratings: data/source/ratings_*.csv not found, run scripts/export_ratings.R to add the model')

# pre-filled photos and videos for player pages (scripts/fetch_player_media.py -> data/source/player_media.json)
if (SRC / 'player_media.json').exists():
    for k, m in json.load(open(SRC / 'player_media.json')).items():
        if k not in players: continue
        # before 1960, modern namesakes crowd the results (another Josh Gibson's podcast), so a video has to look like baseball
        o = players[k]; ctx = ['baseball', 'mlb', 'hall of fame', 'negro league', 'world series', 'hof'] + [st[1].split()[-1].lower() for st in o.get('st', [])]
        ctx += ['footage', 'film', 'newsreel'] + [str(y) for y in range((o.get('pk') or 1950) - 15, (o.get('pk') or 1950) + 16)]
        full = norm(o['f'] + o['l'])
        ok = lambda v, x: v and ((o.get('pk') or 2000) >= 1960 or any(c in v[1].lower() for c in ctx) or (x == 'hl' and full in norm(v[1])))
        md = {x: m[x] for x in ('hl', 'iv') if ok(m.get(x), x)}
        if md.get('iv') and md.get('hl') and md['iv'][0] == md['hl'][0]: del md['iv']  # one search can find the same video twice
        if m.get('ph'): md['ph'] = [[x['u'], x['credit'], x['license'], x['page'], x.get('cap', '')] for x in m['ph']]
        if md: players[k]['md'] = md

# stories from the career and about the person, each linked to its source (data/source/player_stories.json, written
# from the SABR biographies and Wikipedia articles that scripts/fetch_player_sources.py gathers)
if (SRC / 'player_stories.json').exists():
    for k, st in json.load(open(SRC / 'player_stories.json')).items():
        if k in players and (st.get('c') or st.get('p')): players[k]['sto'] = {x: st[x] for x in ('c', 'p') if st.get(x)}

# ---------------------------------------------------------------- season stats and team rosters
# players get year-by-year lines (per team); every team season gets a lineup, rotation, bullpen and bench,
# written to docs/data/rosters.json, which the site loads the first time a team page opens
key_of = {o['id']: k for k, o in players.items() if o.get('id')}
f3n = lambda x: f3(x) if x == x else ''
BC = ['G', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'SB', 'BB', 'SO', 'HBP', 'SF']
B1 = BAT.groupby(['playerID', 'yearID', 'teamID'], as_index=False)[BC].sum().astype({c: float for c in BC})
B1['PA'] = B1.AB + B1.BB + B1.HBP + B1.SF
B1['AVG'] = (B1.H / B1.AB).where(B1.AB > 0); B1['OBP'] = ((B1.H + B1.BB + B1.HBP) / B1.PA).where(B1.PA > 0)
B1['SLG'] = ((B1.H + B1['2B'] + 2 * B1['3B'] + 3 * B1.HR) / B1.AB).where(B1.AB > 0)
PC = ['W', 'L', 'G', 'GS', 'SV', 'IPOuts', 'H', 'ER', 'BB', 'SO', 'HR']
P1 = PIT.groupby(['playerID', 'yearID', 'teamID'], as_index=False)[PC].sum().astype({c: float for c in PC})
P1['ERA'] = (27 * P1.ER / P1.IPOuts).where(P1.IPOuts > 0)
ipf = lambda o: f"{int(o // 3)}{'.' + str(int(o % 3)) if o % 3 else ''}"
batl = lambda r: [int(r.G), int(r.PA), int(r.AB), int(r.R), int(r.H), int(r['2B']), int(r['3B']), int(r.HR), int(r.RBI), int(r.SB), int(r.BB), int(r.SO), f3n(r.AVG), f3n(r.OBP), f3n(r.SLG)]
pitl = lambda r: [int(r.W), int(r.L), int(r.G), int(r.GS), int(r.SV), ipf(r.IPOuts), int(r.H), int(r.BB), int(r.SO), int(r.HR), '%.2f' % r.ERA if r.ERA == r.ERA else '']

# player pages: [year, tid, team label, batting line or None, pitching line or None]
bk = {(r.playerID, int(r.yearID), r.teamID): batl(r) for _, r in B1[B1.playerID.isin(key_of)].iterrows()}
pk_ = {(r.playerID, int(r.yearID), r.teamID): pitl(r) for _, r in P1[P1.playerID.isin(key_of)].iterrows()}
for pid, k in key_of.items():
    rows = sorted({kk[1:] for kk in list(bk) + list(pk_) if kk[0] == pid})
    players[k]['ss'] = [[y, tkey.get((tm, y)), (teams.get(tkey.get((tm, y))) or {}).get('br') or tm, bk.get((pid, y, tm)), pk_.get((pid, y, tm))] for y, tm in rows]

# players outside the database: year-by-year lines from your ratings sheet's other-league tabs
# (scripts/export_other_leagues.py), and club pages for the clubs they played for (data/overrides/clubs.csv)
CLUBS = {}  # slug -> {n, c, cn, ll, pl: {key: [y0, y1]}}
slug = lambda n: re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', n).encode('ascii', 'ignore').decode().lower()).strip('-')
CL = {r.short: r for r in pd.read_csv(OVR / 'clubs.csv').itertuples()} if (OVR / 'clubs.csv').exists() else {}
def club(name, city=None, lat=None, lon=None, country=None):
    r = CL.get(name)
    if r is not None: name, city, lat, lon, country = r.name, r.city, r.lat, r.lon, r.country
    k = slug(name); c = CLUBS.setdefault(k, dict(n=name, c=city, cn=country, ll=[float(lat), float(lon)] if lat is not None else None, pl={}))
    if not c['ll'] and lat is not None: c['ll'] = [float(lat), float(lon)]
    return k
def played(k, key, y=None):
    c = CLUBS[k]; cur = c['pl'].get(key)
    if y is None: c['pl'].setdefault(key, None); return
    c['pl'][key] = [min(cur[0], y), max(cur[1], y)] if cur else [y, y]
by_nm = {norm(o['f'] + o['l']): k for k, o in players.items()}
num = lambda v: float(v) if str(v).strip() not in ('', 'nan') else 0.0
f3s = lambda v: ('%.3f' % float(v)).lstrip('0') if str(v).strip() not in ('', 'nan') else ''
def sheet(f):
    p = SRC / f
    return [r for r in csv.DictReader(open(p, encoding='utf-8'))] if p.exists() else []
JH, JP = sheet('japan_hitters.csv'), sheet('japan_pitchers.csv')  # the other tabs are full-season translations, not real lines
other = {}  # key -> {(y, team): [bat, pit]}
for r in JH:
    k = by_nm.get(norm(r['name_common'])); y = int(float(r['yearID']))
    if not k or players[k].get('ss'): continue
    t = r['Tm']; bat = [int(num(r['G'])), int(num(r['PA'])), int(num(r['AB'])), int(num(r['R'])), int(num(r['H'])), int(num(r['2B'])), int(num(r['3B'])), int(num(r['HR'])),
                         int(num(r['RBI'])), int(num(r['SB'])), int(num(r['BB'])), int(num(r['SO'])), f3s(r['BA']), f3s(r['OBP']), f3s(r['SLG'])]
    other.setdefault(k, {}).setdefault((y, t), [None, None])[0] = bat
for r in JP:
    k = by_nm.get(norm(r['name_common'])); y = int(float(r['yearID']))
    if not k or players[k].get('ss'): continue
    pit = [int(num(r['W'])), int(num(r['L'])), int(num(r['G'])), int(num(r['GS'])), int(num(r['SV'])), r['IP'] or '', int(num(r['H'])), int(num(r['BB'])), int(num(r['SO'])), int(num(r['HR'])), ('%.2f' % float(r['ERA'])) if r['ERA'] else '']
    other.setdefault(k, {}).setdefault((y, r['Tm']), [None, None])[1] = pit
for k, rows in other.items():
    o = players[k]; ss = []
    for (y, t), (bat, pit) in sorted(rows.items()):
        ck = club(t) if t in CL else None
        if ck: played(ck, k, y)
        ss.append([y, None, t, bat, pit, ck])
    o['ss'] = ss
    B = [r[3] for r in ss if r[3]]; Pp = [r[4] for r in ss if r[4]]
    if B and any(isinstance(b[2], int) and b[2] for b in B):
        sm = lambda i: sum(b[i] for b in B if isinstance(b[i], int)); ab, h = sm(2), sm(4); bb, pa = sm(10), sm(1)
        tb = h + sm(5) + 2 * sm(6) + 3 * sm(7)
        raw = [r for r in JH if by_nm.get(norm(r['name_common'])) == k]; hbp, sf = sum(num(r['HBP']) for r in raw), sum(num(r['SF']) for r in raw)
        o['bat'] = dict(G=sm(0), AB=ab, H=h, HR=sm(7), R=sm(3), RBI=sm(8), SB=sm(9), BB=bb, AVG=f3(h / ab) if ab else '',
                        OBP=f3((h + bb + hbp) / (ab + bb + hbp + sf)) if ab else '', SLG=f3(tb / ab) if ab else '')
    if Pp:
        sm = lambda i: sum(x[i] for x in Pp if isinstance(x[i], int)); ip = sum(float(str(x[5]).split('.')[0] or 0) + (int(str(x[5]).split('.')[1]) / 3 if '.' in str(x[5]) else 0) for x in Pp)
        o['pit'] = dict(W=sm(0), L=sm(1), G=sm(2), GS=sm(3), SV=sm(4), IP=f"{int(ip)}{'.' + str(round((ip % 1) * 3)) if ip % 1 else ''}", SO=sm(8), BB=sm(7), ERA='')
# hand-entered clubs (data/overrides/manual_players.csv) join the same pages
for k, o in players.items():
    for c in o.get('clubs') or []:
        ck = club(c[0], c[1], c[2], c[3], (o.get('from') or {}).get('n')); c.append(ck)
        if k not in CLUBS[ck]['pl']: played(ck, k)
clubs_out = {k: dict(n=c['n'], c=c['c'], cn=c['cn'], ll=c['ll'], pl=[[pk, *(yy or [None, None])] for pk, yy in c['pl'].items()]) for k, c in CLUBS.items() if c['pl']}
print(f"other leagues: season lines for {len(other)} players; {len(clubs_out)} club pages")

# team pages: lineup by position (most games there, each player once), rotation, bullpen, bench
PN = {p: f"{f or ''} {l or ''}".strip() for p, f, l in zip(P.playerID, P.nameFirst, P.nameLast)}
POSC = [('C', 'G_c'), ('1B', 'G_1b'), ('2B', 'G_2b'), ('3B', 'G_3b'), ('SS', 'G_ss'), ('LF', 'G_lf'), ('CF', 'G_cf'), ('RF', 'G_rf'), ('DH', 'G_dh')]
AP2 = A.assign(st=A.GS.fillna(A.G_defense.fillna(0) + A.G_dh.fillna(0))).fillna(0)  # starts; games played where GS is unrecorded
bl = {(r.playerID, int(r.yearID), r.teamID): r for r in B1.itertuples(index=False)}
pl = {(r.playerID, int(r.yearID), r.teamID): r for r in P1.itertuples(index=False)}
who = lambda p, y: [PN.get(p, p), key_of.get(p), rating_of.get((p, y))]
def hit_row(pos, p, y, tm, g):
    b = bl.get((p, y, tm))
    return [pos, *who(p, y), int(g), int(b.HR) if b else 0, f3n(b.AVG) if b else '', f3n(b.OBP) if b else '', f3n(b.SLG) if b else '']
def pit_row(p, y, tm):
    q = pl[(p, y, tm)]
    return [*who(p, y), int(q.G), int(q.GS), int(q.W), int(q.L), int(q.SV), ipf(q.IPOuts), '%.2f' % q.ERA if q.ERA == q.ERA else '']
def assign(w):  # max-weight assignment of rows (positions) to columns (players): Hungarian method on -w
    n, m = len(w), len(w[0]); INF = float('inf'); big = max(max(r) for r in w) + 1
    cost = [[big - x for x in r] for r in w]; u, v, p, way = [0] * (n + 1), [0] * (m + 1), [0] * (m + 1), [0] * (m + 1)
    for i in range(1, n + 1):
        p[0], j0 = i, 0; minv, used = [INF] * (m + 1), [False] * (m + 1)
        while True:
            used[j0] = True; i0, delta, j1 = p[j0], INF, 0
            for j in range(1, m + 1):
                if not used[j]:
                    cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]: minv[j], way[j] = cur, j0
                    if minv[j] < delta: delta, j1 = minv[j], j
            for j in range(m + 1):
                if used[j]: u[p[j]] += delta; v[j] -= delta
                else: minv[j] -= delta
            j0 = j1
            if p[j0] == 0: break
        while j0: j1 = way[j0]; p[j0] = p[j1]; j0 = j1
    return {p[j] - 1: j - 1 for j in range(1, m + 1) if p[j]}
def best_lineup(g):
    """Lineup = the assignment of players to positions with the most games, each player once; a player's games count
    in proportion to how many he started, so a late-inning defensive sub doesn't beat a regular who moved around.
    Half his starts anywhere count too, so a regular split across 1B, LF and DH isn't benched for part-timers."""
    g = g[g[[c for _, c in POSC]].sum(axis=1) > 0]
    if g.empty: return {}
    ps = list(g.playerID); share = [min(1, (r.GS or 0) / r.G_all) if r.G_all else 0 for r in g.itertuples()]
    pos = [(p, c) for p, c in POSC if p != 'DH' or g[c].max() >= 15]
    w = [[g.iloc[j][c] * (.5 + .5 * share[j]) + .5 * g.iloc[j].st if g.iloc[j][c] > 0 else 0 for j in range(len(ps))] for _, c in pos]
    pad = max(0, len(pos) - len(ps)); w = [row + [0] * pad for row in w]
    return {pos[i][0]: (ps[j], int(g.iloc[j][pos[i][1]])) for i, j in assign(w).items() if j < len(ps) and g.iloc[j][pos[i][1]] > 0}
rosters = {}
for (y, tm), g in AP2.groupby(['yearID', 'teamID']):
    y = int(y); tid = tkey.get((tm, y))
    if not tid or not teams[tid].get('top'): continue
    lineup = best_lineup(g); used = {p for p, _ in lineup.values()}
    gall = dict(zip(g.playerID, g.G_all))
    L = [hit_row(pos, lineup[pos][0], y, tm, gall[lineup[pos][0]]) for pos, _ in POSC if pos in lineup]
    bench = g[~g.playerID.isin(used) & (g.G_batting > g.G_p)].assign(pa=lambda d: [bl[(p, y, tm)].PA if (p, y, tm) in bl else 0 for p in d.playerID])
    Bn = [hit_row(next((pos for pos, c in POSC if r[c] == max(r[c2] for _, c2 in POSC) and r[c] > 0), 'PH'), r.playerID, y, tm, r.G_all)
          for _, r in bench.nlargest(5, 'pa').iterrows() if r.pa > 0]
    ps = [p for p in g.playerID if (p, y, tm) in pl]
    rot = sorted(ps, key=lambda p: (-pl[(p, y, tm)].GS, -pl[(p, y, tm)].IPOuts))[:5]
    rot = [p for p in rot if pl[(p, y, tm)].GS > 0]
    pen = sorted([p for p in ps if p not in rot and pl[(p, y, tm)].G > pl[(p, y, tm)].GS],
                 key=lambda p: (-pl[(p, y, tm)].SV, -(pl[(p, y, tm)].G - pl[(p, y, tm)].GS)))[:5]
    rosters[tid] = dict(L=L, B=Bn, R=[pit_row(p, y, tm) for p in rot], P=[pit_row(p, y, tm) for p in pen])
rosters = {tid: r for tid, r in rosters.items() if teams[tid].get('top')}  # only tracked team seasons have pages
(OUT / 'rosters.json').write_text(json.dumps(rosters, separators=(',', ':'), ensure_ascii=False))
print(f'rosters: {len(rosters)} team seasons; season lines for {sum(1 for o in players.values() if o.get("ss"))} players')

# games from the 'Others' row of your Games tab (data/overrides/manual_games.csv), after the ranked list
if (OVR / 'manual_games.csv').exists():
    for i, r in enumerate(pd.read_csv(OVR / 'manual_games.csv').itertuples(), start=len(games) + 1):
        tid = r.tid if isinstance(r.tid, str) and r.tid in teams else None
        games[str(i)] = dict(rk=i, y=int(r.y), g=r.g, inn=nz(r.inn), d=r.d, sc=None, cw=None, wpa=None, li=None,
                             tm=teams[tid]['br'] if tid else None, tid=tid, gr=0, o=1)
        years.setdefault(int(r.y), {}).setdefault('games', []).append(str(i))

# ---------------------------------------------------------------- game titles, line scores, lineups (Retrosheet)
# Titles are written out ("World Series, Game 6"). Each game is matched to its Retrosheet game log row by year and
# round/game number, or by date and teams for regular-season games; that gives a line score, the pitchers of record,
# the starting lineups and the Baseball-Reference box score link. Data from data/retrosheet/ (scripts/fetch_retrosheet.py):
# the information used here was obtained free of charge from and is copyrighted by Retrosheet (www.retrosheet.org).
import zipfile, csv, io
RET = ROOT / 'data' / 'retrosheet'
def gl_rows(zname, member=None):
    p = RET / zname
    if not p.exists(): return []
    with zipfile.ZipFile(p) as z:
        names = [member] if member else z.namelist()
        return [row for n in names if n in z.namelist() for row in csv.reader(io.StringIO(z.read(n).decode('latin-1')))]
POST = {f: gl_rows(f) for f in ['glws.zip', 'gllc.zip', 'gldv.zip', 'glwc.zip']}
retro2tid = {(retro_of[t], teams[t]['y']): t for t in retro_of}
def code2tid(code, y):
    return brmap.get((code, y)) or brmap.get((BRFIX.get(code, code), y)) or tkey.get((code, y))
PLACE_PREFIX = sorted({str(r.city) for r in PK.itertuples() if r.city} | set(ST.values()) | {'Tampa Bay', 'Golden State', 'Kansas City', 'New York', 'Los Angeles'}, key=len, reverse=True)
def nick(tid):
    n = teams[tid]['n']
    for pre in PLACE_PREFIX:
        if n.startswith(pre + ' ') and len(n) > len(pre) + 1: return n[len(pre) + 1:]
    return n
LGN = {'AL': 'American League', 'NL': 'National League'}
ROUND = {'glws.zip': 'World Series', 'gllc.zip': 'Championship Series', 'gldv.zip': 'Division Series', 'glwc.zip': 'Wild Card Series'}
POSN = {'1': 'P', '2': 'C', '3': '1B', '4': '2B', '5': '3B', '6': 'SS', '7': 'LF', '8': 'CF', '9': 'RF', '10': 'DH'}
MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
def innings(line):
    out, i = [], 0
    while i < len(line):
        if line[i] == '(': j = line.index(')', i); out.append(line[i + 1:j]); i = j + 1
        else: out.append(line[i]); i += 1
    return out
reg_cache = {}
def reg_rows(y):
    if y not in reg_cache: reg_cache[y] = gl_rows('gl1871_2025.zip', f'gl{y}.txt')
    return reg_cache[y]
def series_rows(files, y, pred):
    rows = [(f, r) for f in files for r in POST[f] if r[0][:4] == str(y) and pred(r)]
    return sorted(rows, key=lambda x: (x[1][0], x[1][1]))
retro_who = {r.retroID: [key_of.get(r.playerID), nz(r.bbrefID)] for r in P.itertuples() if r.retroID}  # a lineup's Retrosheet id -> [your list's player key, bbref id]
who_ = lambda n: '' if n.strip() in ('', '(none)') else n  # Retrosheet writes '(none)' for no save
# what a park was called that season (naming rights change): data/overrides/park_names.csv, else Lahman's name
PARK_AT = pd.read_csv(OVR / 'park_names.csv').itertuples() if (OVR / 'park_names.csv').exists() else []
PARK_AT = [(r.park, int(r.y0), int(r.y1), r.name) for r in PARK_AT]
def park_at(pid, y, default):
    return next((n for p, y0, y1, n in PARK_AT if p == pid and y0 <= y <= y1), default)
fullname = lambda tid, code: teams[tid]['n'] if tid else code
def box(r):  # one game log row -> what the page shows
    vt, ht = retro2tid.get((r[3], int(r[0][:4]))), retro2tid.get((r[6], int(r[0][:4])))
    side = lambda tid, code, line, h, e, lu: dict(n=nick(tid) if tid else code, fn=fullname(tid, code), tid=tid, inn=innings(line), r=None, h=int(h or 0), e=int(e or 0),
                                                   lu=[[lu[i + 1], POSN.get(lu[i + 2], lu[i + 2]), *retro_who.get(lu[i], [None, None])] for i in range(0, 27, 3) if lu[i + 1]])
    v = side(vt, r[3], r[19], r[22], r[47], r[105:132]); h = side(ht, r[6], r[20], r[50], r[75], r[132:159])
    v['r'], h['r'] = int(r[9]), int(r[10])
    pk = PKd.get(r[16]); date = r[0]
    return dict(gid=r[6] + date + r[1], date=f"{MONTHS[int(date[4:6]) - 1]} {int(date[6:])}, {date[:4]}", park=park_at(r[16], int(date[:4]), pk.parkname if pk else r[16]),
                att=int(r[17]) if r[17].isdigit() and int(r[17]) else None,
                time=int(r[18]) if r[18].isdigit() and int(r[18]) else None, v=v, h=h, wp=who_(r[94]), lp=who_(r[96]), sv=who_(r[98]), wpl=retro_who.get(r[93]), lpl=retro_who.get(r[95]), svl=retro_who.get(r[97]),
                br=f"https://www.baseball-reference.com/boxes/{r[6]}/{r[6]}{date}{r[1]}.shtml")
def series(rows, row, vr, hr, nm):  # the series standing after this game, and how long the series was: ['Astros lead series 3–2', 7]
    win = lambda r: r[vr[0]] if int(r[vr[1]]) > int(r[hr[1]]) else r[hr[0]] if int(r[hr[1]]) > int(r[vr[1]]) else None
    final = {}
    for r in rows: final[win(r)] = final.get(win(r), 0) + 1
    need = max(n for t, n in final.items() if t)
    if need < 2: return None  # a one-game playoff
    w, ties = {}, 0
    for r in rows[:rows.index(row) + 1]:
        t = win(r); ties += not t; w[t] = w.get(t, 0) + 1
    a, b = row[vr[0]], row[hr[0]]
    (lead, x), (_, z) = sorted([(a, w.get(a, 0)), (b, w.get(b, 0))], key=lambda p: -p[1])
    s = f'Series tied {x}–{z}' if x == z else f"{nm(lead)} {'win' if x == need else 'lead'} series {x}–{z}"
    return [s + (f" ({ties} tie{'s' if ties > 1 else ''})" if ties else ''), 2 * need - 1]

# Negro Leagues World Series games aren't in the game logs: line score, teams and park from Retrosheet's CSVs
CSVD = RET / 'csv'
def zcsv(zname, member, keep=lambda r: True):
    p = CSVD / zname
    if not p.exists(): return []
    with zipfile.ZipFile(p) as z:
        member = next((n for n in z.namelist() if n.endswith(member)), None)  # a season's files are 1975batting.csv...
        if not member: return []
        with z.open(member) as f: return [r for r in csv.DictReader(io.TextIOWrapper(f, 'latin-1')) if r.get('stattype', 'value') == 'value' and keep(r)]
BIO = {m: zcsv('biodata.zip', m) for m in ['teams0.csv', 'ballparks0.csv']}
RPARK = {r['site']: r['name'].split(';')[0] for r in BIO['ballparks0.csv']}
name2tid = {(t['n'], t['y']): tid for tid, t in teams.items()}
RTEAM = {r['team']: f"{r['city']} {r['nickname']}" for r in BIO['teams0.csv']}
def rtid(code, y): return retro2tid.get((code, y)) or name2tid.get((RTEAM.get(code), y))
NEGRO = sorted([r for r in zcsv('negroleagues.zip', 'gameinfo.csv') if r['gametype'] == 'championship'], key=lambda r: (r['date'], r['number']))
NEGRO_TS = {(r['gid'], r['team']): r for r in zcsv('negroleagues.zip', 'teamstats.csv', lambda r: r['gametype'] == 'championship')}
NEGRO_NAMES = {r['id']: f"{r['first']} {r['last']}" for r in zcsv('negroleagues.zip', 'allplayers.csv')}
def negro_box(gi):
    y = int(gi['date'][:4])
    def side(code):
        ts, tid = NEGRO_TS.get((gi['gid'], code), {}), rtid(code, y)
        inn = [ts.get(f'inn{i}', '') for i in range(1, 29)]
        while inn and inn[-1] == '': inn.pop()
        iv = lambda k: int(ts[k]) if ts.get(k, '').lstrip('-').isdigit() else 0
        return dict(n=nick(tid) if tid else RTEAM.get(code, code), fn=fullname(tid, RTEAM.get(code, code)), tid=tid, inn=inn, r=iv('b_r'), h=iv('b_h'), e=iv('d_e'), lu=[])
    nm = lambda i: NEGRO_NAMES.get(i, '') if i and i != '(none)' else ''
    d = gi['date']
    return dict(gid=gi['gid'], date=f"{MONTHS[int(d[4:6]) - 1]} {int(d[6:])}, {d[:4]}", park=park_at(gi['site'], y, RPARK.get(gi['site'], gi['site'])),
                att=int(gi['attendance']) if gi['attendance'].isdigit() and int(gi['attendance']) else None,
                time=int(gi['timeofgame']) if gi['timeofgame'].isdigit() and int(gi['timeofgame']) else None, v=side(gi['visteam']), h=side(gi['hometeam']),
                wp=nm(gi['wp']), lp=nm(gi['lp']), sv=nm(gi['save']), wpl=retro_who.get(gi['wp']), lpl=retro_who.get(gi['lp']), svl=retro_who.get(gi['save']), br=None)

boxes, matched = {}, 0
for key, g in games.items():
    y, lab = g['y'], g['g']; row = rnd = None; title = lab; srcz = 'postseason.zip'
    if m := re.match(r'^(WS|ALCS|NLCS) G(\d+)$', lab):
        lg = {'ALCS': 'AL', 'NLCS': 'NL'}.get(m[1])
        rows = series_rows(['glws.zip'] if m[1] == 'WS' else ['gllc.zip'], y, lambda r: not lg or r[7] == lg)
        title = f"{'World Series' if m[1] == 'WS' else LGN[lg] + ' Championship Series'}, Game {m[2]}"
        if len(rows) >= int(m[2]): rnd, row = rows[int(m[2]) - 1]
    elif m := re.match(r'^([AN])([EW])DS G(\d+)$', lab):
        lg, dv = {'A': 'AL', 'N': 'NL'}[m[1]], m[2]
        rows = series_rows(['gldv.zip'], y, lambda r: r[7] == lg and (teams.get(retro2tid.get((r[6], y)), {}).get('dv') == dv))
        title = f"{LGN[lg]} {'East' if dv == 'E' else 'West'} Division Series, Game {m[3]}"
        if len(rows) >= int(m[3]): rnd, row = rows[int(m[3]) - 1]
    elif m := re.match(r'^(AL|NL)WC$', lab):
        rows = series_rows(['glwc.zip'], y, lambda r: r[7] == m[1]); title = f"{LGN[m[1]]} Wild Card Game"
        if rows: rnd, row = rows[0]
    elif m := re.match(r'^([A-Z]{2,3})-([A-Z]{2,3}) G(\d+)$', lab):
        a, c = code2tid(m[1], y), code2tid(m[2], y); pair = {retro_of.get(a), retro_of.get(c)}
        rows = series_rows(['gldv.zip', 'glwc.zip', 'gllc.zip', 'glws.zip'], y, lambda r: {r[3], r[6]} == pair)
        if len(rows) >= int(m[3]): rnd, row = rows[int(m[3]) - 1]
        title = (f"{LGN.get(row[7], '')} {ROUND[rnd]}, Game {m[3]}".strip() if row else f"{nick(a) if a else m[1]} vs. {nick(c) if c else m[2]}, Game {m[3]}")
    elif m := (re.match(r'^(\d{1,2})/(\d{1,2}) ([A-Z]{2,3})-([A-Z]{2,3})$', lab) or re.match(r'^([A-Z]{2,3})-([A-Z]{2,3}) (\d{1,2})/(\d{1,2})$', lab)):
        mo, dy, t1, t2 = (m[1], m[2], m[3], m[4]) if lab[0].isdigit() else (m[3], m[4], m[1], m[2])
        a, c = code2tid(t1, y), code2tid(t2, y); pair = {retro_of.get(a), retro_of.get(c)}
        rows = [r for r in reg_rows(y) if r[0] == f"{y}{int(mo):02d}{int(dy):02d}" and {r[3], r[6]} == pair]
        if rows: row = rows[0]
        title = f"{MONTHS[int(mo) - 1]} {int(dy)}"; srcz = f'{y}csvs.zip'
    elif m := re.match(r'^Negro WS G(\d+)$', lab):
        title = f"Negro World Series, Game {m[1]}"
        rows = [r for r in NEGRO if r['date'][:4] == str(y)]
        if len(rows) >= int(m[1]):
            gi = rows[int(m[1]) - 1]; bx = negro_box(gi); bx['src'] = 'negroleagues.zip'
            bx['ser'] = series(rows, gi, ('visteam', 'vruns'), ('hometeam', 'hruns'), lambda c: nick(t) if (t := rtid(c, y)) else RTEAM.get(c, c))
            boxes[key] = bx; matched += 1
    g['gt'] = title
    if row:
        bx = box(row); bx['src'] = srcz; boxes[key] = bx; matched += 1
        if rnd:
            pair = {row[3], row[6]}
            bx['ser'] = series([r for f, r in series_rows([rnd], y, lambda r: {r[3], r[6]} == pair)], row, (3, 9), (6, 10), lambda c: nick(t) if (t := retro2tid.get((c, y))) else c)
    if key in boxes:
        bx = boxes[key]
        g['vs'] = f"{bx['v']['n']} at {bx['h']['n']}"; g['nm'] = [bx['v']['fn'], bx['h']['fn']]
        if not (g['tid'] and teams.get(g['tid'], {}).get('top')) and bx['h']['tid']: g.setdefault('tid', bx['h']['tid'])

# box scores: every batter's and pitcher's line, from Retrosheet's per-game CSVs (postseason, Negro Leagues, and each
# season with a regular-season game on your list). Batters: [name, pos, AB, R, H, RBI, BB, SO, 2B, 3B, HR, SB, sub, key, bbref];
# pitchers: [name, outs, H, R, ER, BB, SO, HR, decision, key, bbref]. Blank is unknown (old box scores leave some out).
want = {}
for key, bx in boxes.items(): want.setdefault(bx.pop('src'), {})[bx['gid']] = key
iv = lambda x: int(x) if x not in ('', None) else None
nbox = 0
for zname, gids in want.items():
    keep = lambda r: r['gid'] in gids
    bat, pit, fld = (zcsv(zname, f'{m}.csv', keep) for m in ['batting', 'pitching', 'fielding'])
    if not bat: continue
    names = {r['id']: f"{r['first']} {r['last']}" for r in zcsv(zname, 'allplayers.csv')}
    pos = {}
    for r in sorted(fld, key=lambda r: int(r['d_seq'] or 0)):
        p = POSN.get(r['d_pos'], r['d_pos']); lst = pos.setdefault((r['gid'], r['id']), [])
        if p not in lst: lst.append(p)
    for gid, key in gids.items():
        bx = boxes[key]
        for vh, s in (('v', bx['v']), ('h', bx['h'])):
            rows = sorted([r for r in bat if r['gid'] == gid and r['vishome'] == vh and r['b_lp']], key=lambda r: (int(r['b_lp']), int(r['b_seq'] or 1)))
            def ps(r):
                p = pos.get((gid, r['id']), [])
                if r['dh'] == '1' and 'DH' not in p: p = ['DH'] + p
                return '-'.join((['PH'] if r['ph'] == '1' else []) + (['PR'] if r['pr'] == '1' else []) + p)
            s['bat'] = [[names.get(r['id'], r['id']), ps(r), *(iv(r[c]) for c in ['b_ab', 'b_r', 'b_h', 'b_rbi', 'b_w', 'b_k', 'b_d', 'b_t', 'b_hr', 'b_sb']),
                         1 if int(r['b_seq'] or 1) > 1 else 0, *retro_who.get(r['id'], [None, None])] for r in rows]
            prow = sorted([r for r in pit if r['gid'] == gid and r['vishome'] == vh], key=lambda r: int(r['p_seq'] or 1))
            s['pit'] = [[names.get(r['id'], r['id']), *(iv(r[c]) for c in ['p_ipouts', 'p_h', 'p_r', 'p_er', 'p_w', 'p_k', 'p_hr']),
                         'W' if r['wp'] == '1' else 'L' if r['lp'] == '1' else 'S' if r['save'] == '1' else '', *retro_who.get(r['id'], [None, None])] for r in prow]
            if s['bat']: s['lu'] = []; nbox += 1
for bx in boxes.values(): bx.pop('gid', None)
# a video per game: scripts/fetch_videos.py (data/source/game_videos.csv), or your pick (data/overrides/game_videos.csv)
if (SRC / 'game_videos.csv').exists():
    for r in pd.read_csv(SRC / 'game_videos.csv', dtype=str).fillna('').itertuples():
        if r.rk in games and r.video: games[r.rk]['yt'] = [r.video, r.title, r.channel, int(getattr(r, 'mins', '') or 0)]
if (OVR / 'game_videos.csv').exists():
    for r in pd.read_csv(OVR / 'game_videos.csv', dtype=str).fillna('').itertuples():
        if r.rk in games: games[r.rk]['yt'] = [r.video, r.note, '', 0, 1] if r.video else None
# the Wikipedia write-up of each postseason game (scripts/fetch_game_stories.py)
if (SRC / 'game_stories.json').exists():
    for k, st in json.load(open(SRC / 'game_stories.json')).items():
        if k in games: boxes.setdefault(k, {})['sto'] = st
(OUT / 'games.json').write_text(json.dumps(boxes, separators=(',', ':'), ensure_ascii=False))
print(f'games: {matched} of {len(games)} matched to Retrosheet line scores, {nbox // 2} with full box scores' + ('' if POST['glws.zip'] else ' (run scripts/fetch_retrosheet.py)'))

for tid, ks in roster.items():  # the list's players on each team, best season rating first (as in the lineup)
    cw = {k: rating_of[(players[k]['id'], teams[tid]['y'])] for k in set(ks) if (players[k].get('id'), teams[tid]['y']) in rating_of}
    teams[tid]['ro'] = sorted(set(ks), key=lambda k: (-cw.get(k, -99), players[k]['ovr'] or 999, k))
    if cw: teams[tid]['ros'] = cw
for tid, ks in MANUAL_RO.items():  # and on the hand-entered teams, which also join the players' stints (map pins)
    t = teams[tid]; ks = [k for k in ks if k in players]; t['ro'] = ks
    for k in ks:
        st = players[k].setdefault('st', [])
        run = next((x for x in st if x[0] == t['fr'] and x[3] == t['y'] - 1), None)
        if run: run[3] = t['y']
        else: st.append([t['fr'], t['n'], t['y'], t['y'], 0, tid])
        st.sort(key=lambda x: x[2])
# ---------------------------------------------------------------- managers and executives (franchise pages)
# managers: each run of seasons with a franchise, with his record there: [name, player key or None, bbref id, y0, y1, W, L]
if (LAH / 'Managers.csv').exists():
    key_of = {o['id']: k for k, o in players.items() if o.get('id')}
    MG = rd('Managers').merge(T[['yearID', 'teamID', 'franchID']].astype({'yearID': int}), on=['yearID', 'teamID'])
    MG['page'] = [teams.get(tkey.get((tm, y)), {}).get('fp') for tm, y in zip(MG.teamID, MG.yearID)]
    for fr, g in MG[MG.page.notna()].sort_values(['yearID', 'inseason']).groupby('page'):
        runs = []
        for r in g.itertuples():
            e = runs[-1] if runs and runs[-1][0] == r.playerID and runs[-1][4] >= r.yearID - 1 else None
            if e:
                e[4] = r.yearID; e[5] += int(r.W or 0); e[6] += int(r.L or 0); continue
            runs.append([r.playerID, None, None, r.yearID, r.yearID, int(r.W or 0), int(r.L or 0)])
        for x in runs:
            pid = x[0]; pp = Pi.loc[pid] if pid in Pi.index else None
            x[0] = ' '.join(str(s) for s in (nz(pp.nameFirst), nz(pp.nameLast)) if s) if pp is not None else pid
            x[1], x[2] = key_of.get(pid), (nz(pp.bbrefID) if pp is not None else None)
        franch[fr]['mg'] = runs
else:
    print('no data/lahman/Managers.csv: run python scripts/fetch_lahman.py for manager histories')
# owners and general managers (scripts/fetch_execs.py -> data/source/executives.json): {kind: [[group, [[name, article]...], years]]}
if (SRC / 'executives.json').exists():
    # each row goes to the pages holding that franchise's seasons in its years (Brooklyn's owners to the Brooklyn page)
    def span(yrs):
        ys = [int(y) for y in re.findall(r'\d{4}', yrs)]
        return (ys[0], 2100 if 'present' in yrs or len(ys) < 2 else ys[-1]) if ys else (0, 2100)
    page_years = {}
    for k, f in franch.items():
        for tid in f['s']: page_years.setdefault((teams[tid]['fr'], k), set()).add(teams[tid]['y'])
    for fr, ex in json.load(open(SRC / 'executives.json')).items():
        for (lf, k), ys in sorted(page_years.items(), key=lambda kv: min(kv[1])):
            if lf != fr: continue
            for kind, rows in ex.items():
                keep = [r for r in rows if any(span(r[2])[0] <= y <= span(r[2])[1] for y in ys)]
                if keep: franch[k].setdefault('ex', {}).setdefault(kind, []).extend(keep)

# ---------------------------------------------------------------- league pages
# The other major leagues and the Negro leagues from the team seasons; Cuba, the Dominican Republic, Venezuela, Puerto
# Rico and Japan from data/source/league_seasons.json (the franchise workbench's club census). Each season row:
# [year, season label, league, club, city, W, L, flag, team season or None, players from the list]
LEAGUE_PAGES = {
    'AA': ('American Association', ['AA']), 'UA': ('Union Association', ['UA']), 'PL': ("Players' League", ['PL']), 'FL': ('Federal League', ['FL']),
    'NNL': ('Negro National League', ['NNL']), 'NN2': ('Negro National League (II)', ['NN2']), 'NAL': ('Negro American League', ['NAL']),
    'ECL': ('Eastern Colored League', ['ECL']), 'EWL': ('East-West League', ['EWL']),
    'CUB': ('Cuba', None), 'DOM': ('Dominican Republic', None), 'VEN': ('Venezuela', None), 'PR': ('Puerto Rico', None), 'JPN': ('Japan', None)}
LS = json.load(open(SRC / 'league_seasons.json'))['leagues'] if (SRC / 'league_seasons.json').exists() else {}
leagues = {}
for code, (name, lgs) in LEAGUE_PAGES.items():
    if lgs:
        rows = [[t['y'], str(t['y']), t['lg'], t['n'], (t['pl'] or {}).get('c'), t['w'], t['l'], None, tid, [k for k in t.get('ro', []) if k in players]]
                for tid, t in teams.items() if t['lg'] in lgs]
        lg = dict(n=name, subs={}, s=rows)
    elif code in LS:
        src = LS[code]
        lg = dict(n=name, subs=src['subs'], s=[r[:8] + [None, [k for k in r[8] if k in players]] for r in src['seasons']],
                  also=[[r[0], r[1], r[2], r[3], r[4], [k for k in r[5] if k in players]] for r in src.get('also', [])])
    else:
        continue
    lg['s'].sort(key=lambda r: (r[0], r[2], -(r[5] or 0), r[3]))
    lg['y0'], lg['y1'] = min(r[0] for r in lg['s']), max(r[0] for r in lg['s'])
    leagues[code] = lg
print('league pages:', {k: len(v['s']) for k, v in leagues.items()})

# ---------------------------------------------------------------- logos manifest
logos = sorted(p.name for p in (ROOT / 'docs' / 'logos').glob('*') if p.suffix.lower() in ('.png', '.svg', '.jpg', '.jpeg', '.webp', '.none'))
photos_manifest = ROOT / 'docs' / 'data' / 'photos.json'

DATA = dict(clubs=clubs_out, players=players, teams=teams, franch=franch, leagues=leagues, fcol=COLORS, parks=parks, years={str(k): v for k, v in years.items()},
            games=games, eras=eras, logos=logos)
OUT.mkdir(parents=True, exist_ok=True)
s = json.dumps(DATA, separators=(',', ':'), ensure_ascii=False)
(OUT / 'atlas.json').write_text(s)
print(f'wrote docs/data/atlas.json ({len(s)/1e6:.1f} MB), {len(logos)} logo files found')
