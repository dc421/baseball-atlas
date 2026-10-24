"""Build docs/data/atlas.json from your spreadsheet exports + the Lahman database.

Run from the repo root:  python scripts/build_data.py
Inputs:
  data/source/*.csv            exported from Baseball_Watch_List.numbers (see scripts/export_sheet.py)
  data/overrides/*.csv         hand fixes (player matches, "from" places)
  pylahman (pip)               Lahman database, 1871-2025, incl. Negro Leagues
  reverse_geocoder (pip)       city coordinates
Output:
  docs/data/atlas.json
"""
import json, math, re, unicodedata, importlib.util
from pathlib import Path
import numpy as np, pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'data' / 'source'
OVR = ROOT / 'data' / 'overrides'
OUT = ROOT / 'docs' / 'data'
LAH = Path(importlib.util.find_spec('pylahman').submodule_search_locations[0]) / 'data'
RGF = Path(importlib.util.find_spec('reverse_geocoder').submodule_search_locations[0]) / 'rg_cities1000.csv'

rd = lambda n: pd.read_parquet(LAH / f'{n}.parquet')
P, A, T, H, PK, TF, BAT, PIT = [rd(n) for n in ['People', 'Appearances', 'Teams', 'HomeGames', 'Parks', 'TeamsFranchises', 'Batting', 'Pitching']]
BAT = BAT.fillna(0); PIT = PIT.fillna(0)
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
teams, tkey = {}, {}
for r in T.itertuples():
    pk = hg.get((r.yearID, r.teamIDretro)) or hg.get((r.yearID, r.teamID))
    place, ll, ap = (park_geo.get(pk) or (None, None, 0)) if pk else (None, None, 0)
    if ll is None:
        place, ll = team_city(r.name); ap = 1
    tid = f'{r.teamID}-{r.yearID}'
    tkey[(r.teamID, r.yearID)] = tid
    lg = r.lgID or ('NA' if r.yearID <= 1875 else None)
    teams[tid] = dict(y=int(r.yearID), lg=lg, tm=r.teamID, fr=r.franchID, n=r.name, w=nz(r.W), l=nz(r.L), rk=nz(r.Rank),
                      pen=1 if r.LgWin == 'Y' else 0, ws=1 if r.WSWin == 'Y' else 0, dv=nz(r.divID), pk=pk, park=nz(r.park),
                      br=nz(r.teamIDBR), ll=ll, pl=place, ap=ap)
print('team seasons', len(teams), '| without a location:', sorted({t['n'] for t in teams.values() if not t['ll']}))

# franchise colors: data/overrides/team_colors.csv (franchID, bg, fg); others get a neutral badge
COLORS = {r.franchID: [r.bg, r.fg] for r in pd.read_csv(OVR / 'team_colors.csv').itertuples()}
franch = {}
for tid, t in teams.items():
    f = franch.setdefault(t['fr'], dict(n=TFn.get(t['fr'], t['n']), s=[], col=COLORS.get(t['fr'])))
    f['s'].append(tid)

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
             have=None if str(r.Have) == 'nan' else r.Have, ranks=[])
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

# ---------------------------------------------------------------- top 5 by year
top = pd.read_csv(SRC / 'Year-by-Year_Top_5.csv').fillna('')
cellre = re.compile(r'^(?:(C|1B|2B|3B|SS|LF|CF|RF|DH|OF|P|UT)\s+)?(.+?)\s*\(([^)]*)\)\s*$')
by_name = {norm(o['f'] + o['l']): k for k, o in players.items()}
years = {}
for r in top.itertuples(index=False):
    try: y = int(float(r[0]))
    except ValueError: continue
    ent = []
    for ci, cell in enumerate(r[1:13]):
        cell = str(cell).strip()
        if not cell: continue
        m = cellre.match(cell)
        pos, nm, tm = (m.group(1), m.group(2), m.group(3)) if m else (None, cell, '')
        kind = 'H' if ci < 5 else ('P' if ci < 10 else ('RP' if ci == 10 else 'WPA'))
        k = by_name.get(norm(nm))
        ent.append([kind, (ci % 5) + 1 if ci < 10 else 1, pos, nm, tm, k])
        if k: players[k]['ranks'].append([y, kind, (ci % 5) + 1 if ci < 10 else 1])
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
BRFIX = {'MIL': 'MLN', 'MIA': 'FLA', 'WAS': 'WSH', 'LAA': 'ANA', 'TBR': 'TBD'}
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

for tid, ks in roster.items():
    teams[tid]['ro'] = sorted(set(ks), key=lambda k: players[k]['ovr'] or 999)

# ---------------------------------------------------------------- logos manifest
logos = sorted(p.name for p in (ROOT / 'docs' / 'logos').glob('*') if p.suffix.lower() in ('.png', '.svg', '.jpg', '.jpeg', '.webp', '.none'))
photos_manifest = ROOT / 'docs' / 'data' / 'photos.json'

DATA = dict(players=players, teams=teams, franch=franch, parks=parks, years={str(k): v for k, v in years.items()},
            games=games, eras=eras, logos=logos)
OUT.mkdir(parents=True, exist_ok=True)
s = json.dumps(DATA, separators=(',', ':'), ensure_ascii=False)
(OUT / 'atlas.json').write_text(s)
print(f'wrote docs/data/atlas.json ({len(s)/1e6:.1f} MB), {len(logos)} logo files found')
