"""Rank every game Retrosheet has play-by-play for, with the Games tab's formula -> data/source/games_ranked.csv

    python scripts/build_games.py          # then python scripts/build_data.py
    python scripts/build_games.py --redo   # recompute every season (each one is cached in data/retrosheet/games/)

Score = (Inn + 9+SS + SS - 1) x (0.4 + maxL^3 + cWPA1 x gLI^2)^2 x lastL^0.5 x gLI
  Inn     innings played
  9+SS    lead changes from the 9th inning on (a play that goes from behind to ahead counts twice: tied, then ahead)
  SS      the same count over the whole game
  maxL    the loser's best win probability during the game; lastL, the loser's win probability before the last play
          (a tie has no loser: maxL is twice the furthest either side got from even, so it runs 0-1 too, and lastL is the last play's
          swing, the one that ended it at .5)
  WPA1-5  the five biggest swings in win probability; tWPA, all of them added up; cWPA1 = WPA1 x gLI
  gLI     how much the game moved the title odds, P(title | win) - P(title | loss), the average of the two teams'
          (half that in the Negro Leagues' postseason)
Win probability comes from a table built from that season's own run scoring (how often each base-out state led to 0, 1,
2... runs that inning), so 1968's table and 2000's differ the way their games did. Extra innings start with a runner on
second in the 2020-2025 regular seasons, and the 2020-21 seven-inning doubleheader games end after seven.
Postseason gLI comes from the series standing, each game a coin flip, and the rounds left. Regular-season gLI comes from
playing out the rest of the schedule from that day's standings (coin flips again) under that year's postseason format;
only AL and NL games get one. Games with no play-by-play (before 1908, Negro Leagues regular seasons, 2026) come from
data/overrides/games.csv, which also holds your descriptions and picks for the ranked games.
The information used here was obtained free of charge from and is copyrighted by Retrosheet (www.retrosheet.org).
"""
import heapq, io, json, sys, zipfile
from functools import lru_cache
from pathlib import Path
import numpy as np, pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RET = ROOT / 'data' / 'retrosheet'
CSVD, CACHE = RET / 'csv', RET / 'games'
OUT = ROOT / 'data' / 'source' / 'games_ranked.csv'
KEEP = 600  # games written out, best first (the site gives pages to as many as there are tracked team seasons)
SIMS = 4000  # schedule playouts per day for regular-season gLI
K, N, M = 15, 30, 40  # runs in a half-inning, score margin, and innings the tables reach
FIRST, LAST = 1908, 2025  # seasons with play-by-play
PCOLS = ['gid', 'inning', 'top_bot', 'score_v', 'score_h', 'outs_pre', 'br1_pre', 'br2_pre', 'br3_pre', 'runs']
ROUNDS_AFTER = {'worldseries': 0, 'championship': 0, 'lcs': 1, 'divisionseries': 2, 'wildcard': 3}


def read(zname, suffix, **kw):
    with zipfile.ZipFile(CSVD / zname) as z:
        return pd.read_csv(z.open(next(n for n in z.namelist() if n.endswith(suffix))), low_memory=False, **kw)


def plays(zname):
    p = read(zname, 'plays.csv', usecols=PCOLS, dtype={c: str for c in PCOLS[6:9]})
    p['st'] = p.outs_pre.fillna(0).clip(0, 2).astype(int) * 8 + p.br1_pre.notna() + p.br2_pre.notna() * 2 + p.br3_pre.notna() * 4
    return p


# postseasons Retrosheet hasn't published yet, from the MLB Stats API (scripts/fetch_mlbapi.py), in the same columns
RETRO = {'CHC': 'CHN', 'CWS': 'CHA', 'KC': 'KCA', 'LAA': 'ANA', 'LAD': 'LAN', 'NYM': 'NYN', 'NYY': 'NYA', 'SD': 'SDN',
         'SF': 'SFN', 'STL': 'SLN', 'TB': 'TBA', 'WSH': 'WAS', 'AZ': 'ARI'}
API_GT = {'F': 'wildcard', 'D': 'divisionseries', 'L': 'lcs', 'W': 'worldseries'}
NEED = {'wildcard': 2, 'divisionseries': 3, 'lcs': 4, 'worldseries': 4}  # wins to take a series, for one still going


def api_post():
    P, I = [], []
    for f in sorted((RET / 'mlbapi').glob('*/*.json')):
        d = json.loads(f.read_text()); gd = d['gameData']
        v, h = (RETRO.get(gd['teams'][s]['abbreviation'], gd['teams'][s]['abbreviation']) for s in ('away', 'home'))
        date = gd['datetime']['officialDate'].replace('-', '')
        gid = h + date + '0'
        sv = sh = 0; half = None
        for p in d['liveData']['plays']['allPlays']:
            a = p['about']
            if (a['inning'], a['isTopInning']) != half: half, outs, on = (a['inning'], a['isTopInning']), 0, {}
            bases = set(on.values())
            P.append(dict(gid=gid, inning=a['inning'], top_bot=0 if a['isTopInning'] else 1, score_v=sv, score_h=sh, outs_pre=outs,
                          br1_pre='x' if '1B' in bases else None, br2_pre='x' if '2B' in bases else None, br3_pre='x' if '3B' in bases else None,
                          runs=p['result']['awayScore'] - sv + p['result']['homeScore'] - sh))
            for r in p['runners']:
                m, rid = r['movement'], r['details']['runner']['id']
                if m['isOut'] or m['end'] in (None, 'score'): on.pop(rid, None)
                else: on[rid] = m['end']
            sv, sh, outs = p['result']['awayScore'], p['result']['homeScore'], p['count']['outs']
        ls = d['liveData']['linescore']
        I.append(dict(gid=gid, gametype=API_GT[gd['game']['type']], visteam=v, hometeam=h, date=int(date), number=0,
                      innings=ls.get('scheduledInnings', 9), vruns=ls['teams']['away']['runs'], hruns=ls['teams']['home']['runs']))
    if not P: return None, None
    p = pd.DataFrame(P)
    p['st'] = p.outs_pre.clip(0, 2).astype(int) * 8 + p.br1_pre.notna() + p.br2_pre.notna() * 2 + p.br3_pre.notna() * 4
    return p, pd.DataFrame(I)


# ---------------------------------------------------------------- win expectancy
def run_counts(p):  # how many runs scored from each base-out state to the end of the half-inning: 24 x K counts
    h = p[p.inning < 7]  # half-innings that are always played out
    g = h.groupby([h.gid, h.inning, h.top_bot]).runs
    rest = (g.transform('sum') - g.cumsum() + h.runs).clip(0, K - 1).astype(int)
    C = np.zeros((24, K)); np.add.at(C, (h.st.to_numpy(), rest.to_numpy()), 1)
    return C


def table(D, reg=9, ghost=False):  # -> P(home wins) before a play, by [inning, half, base-out state, margin + N]
    m, ks = np.arange(-N, N + 1), np.arange(K)
    Vt, Vb = np.zeros((M + 2, 2 * N + 1)), np.zeros((M + 2, 2 * N + 1))  # at the start of the top / bottom half
    Vt[M + 1] = np.sign(m) / 2 + .5
    W = np.zeros((M + 1, 2, 24, 2 * N + 1))
    for i in range(M, 0, -1):
        f = D[2] if ghost and i > reg else D[0]
        def after_bot(e):  # home margin e at the end of the bottom half -> P(home wins)
            if i >= reg: return np.where(e > 0, 1., np.where(e < 0, 0., Vt[i + 1, N]))
            return Vt[i + 1, np.clip(e, -N, N) + N]
        AB = after_bot(m[:, None] + ks)  # walk-offs: once home leads in the last inning, the rest of the half doesn't count
        Vb[i] = AB @ f
        if i >= reg: Vb[i, m > 0] = 1
        AT = Vb[i, np.clip(m[:, None] - ks, -N, N) + N]
        Vt[i] = AT @ f
        W[i, 0], W[i, 1] = D @ AT.T, D @ AB.T
    return W


class Env:  # a season's run scoring, with a little of every season's mixed in so rare states aren't noise
    BASE = None
    def __init__(self, C):
        n = C.sum(1, keepdims=True); self.D = (C + 30 * Env.BASE) / (n + 30); self.t = {}
    def W(self, reg, ghost):
        if (reg, ghost) not in self.t: self.t[reg, ghost] = table(self.D, reg, ghost)
        return self.t[reg, ghost]


def game_stats(p, info, env, ghost):
    """Every game in p (plays in order) -> one row of the columns above. info: gameinfo (gid, innings, vruns, hruns)."""
    reg = pd.to_numeric(info.set_index('gid').innings, errors='coerce').reindex(p.gid).fillna(9).clip(7, 9).astype(int).to_numpy()
    i, half = p.inning.clip(1, M).astype(int).to_numpy(), p.top_bot.astype(int).to_numpy()
    mg = (p.score_h - p.score_v).to_numpy()
    we = np.empty(len(p))
    for r in np.unique(reg):
        s = reg == r; we[s] = env.W(int(r), ghost)[i[s], half[s], p.st.to_numpy()[s], np.clip(mg[s], -N, N) + N]
    gid = p.gid.to_numpy(); last = np.r_[gid[1:] != gid[:-1], True]
    fh = p.score_h + np.where(half == 1, p.runs, 0); fv = p.score_v + np.where(half == 0, p.runs, 0)
    final = (np.sign(fh - fv) / 2 + .5).to_numpy()  # 1 home win, 0 loss, .5 tie
    after = np.r_[we[1:], 0]; after[last] = final[last]
    d = pd.DataFrame(dict(gid=gid, inning=i, we=we, sw=np.abs(after - we), fh=fh, fv=fv, final=final, last=last,
                          sa=np.abs(np.sign(fh - fv) - np.sign(mg))))
    d['ss'] = d.sa * (d.inning >= reg)
    g = d.groupby('gid', sort=False)
    o = g.agg(inn=('inning', 'max'), ss9=('ss', 'sum'), ss=('sa', 'sum'), twpa=('sw', 'sum'))
    fin = d[d['last']].set_index('gid')
    o['vr'], o['hr'], res = fin.fv.astype(int), fin.fh.astype(int), fin.final
    lose = np.where(res.reindex(d.gid).to_numpy() == 0, d.we, np.where(res.reindex(d.gid).to_numpy() == 1, 1 - d.we, 2 * np.abs(d.we - .5)))
    o['maxl'] = pd.Series(lose).groupby(d.gid.to_numpy(), sort=False).max()
    o['lastl'] = pd.Series(lose[d['last'].to_numpy()], index=fin.index).where(res != .5, fin.sw)
    o['tie'] = (res == .5).astype(int)
    o['v'], o['h'] = info.set_index('gid').visteam.reindex(o.index), info.set_index('gid').hometeam.reindex(o.index)
    top = d.sort_values(['gid', 'sw'], ascending=[True, False]).groupby('gid').sw.head(5)
    top = d.loc[top.index, ['gid', 'sw']].assign(n=lambda x: x.groupby('gid').cumcount() + 1).pivot(index='gid', columns='n', values='sw')
    for n in range(1, 6): o[f'wpa{n}'] = top.get(n)
    # keep games whose play-by-play adds up to the final score
    chk = info.set_index('gid')[['vruns', 'hruns']].apply(pd.to_numeric, errors='coerce').reindex(o.index)
    return o[(chk.vruns == o.vr) & (chk.hruns == o.hr)].round(4)


# ---------------------------------------------------------------- title odds (gLI)
@lru_cache(None)
def series_odds(a, b, need):  # P(first to `need` wins) from a-b, each game a coin flip
    return 1. if a >= need else 0. if b >= need else .5 * (series_odds(a + 1, b, need) + series_odds(a, b + 1, need))


def post_gli(info):  # postseason gameinfo -> gid: [gLI, round, game number in the series]
    info = info.sort_values(['date', 'number'])
    ser = []  # (year, round, games, wins per game, wins needed, series winner)
    for (y, gt, _), s in info.groupby([info.date.astype(str).str[:4], info.gametype, info.apply(lambda r: '-'.join(sorted([r.visteam, r.hometeam])), axis=1)]):
        win = np.where(s.hruns > s.vruns, s.hometeam, np.where(s.vruns > s.hruns, s.visteam, None))
        wc = pd.Series(win).value_counts()
        need = int(wc.max()) if len(wc) else 0
        if int(y) > LAST: need = max(need, NEED[gt])  # a series still being played
        ser.append((int(y), gt, s, win, need, wc.idxmax() if len(wc) else None))
    order = ['divisionseries', 'lcs', 'championship']
    out = {}
    for y, gt, s, win, need, champ in ser:
        if y >= 1969: after = ROUNDS_AFTER.get(gt, 0)
        else:  # the Negro Leagues' playoffs had no set shape: count the later rounds the series winner went on to play
            after = sum(1 for y2, gt2, s2, *_ in ser if y2 == y and gt in order and gt2 in order and order.index(gt2) > order.index(gt)
                        and champ in (set(s2.visteam) | set(s2.hometeam)))
        w = {}
        for n, (r, x) in enumerate(zip(s.itertuples(), win), start=1):
            a, b = w.get(r.hometeam, 0), w.get(r.visteam, 0)
            out[r.gid] = [(series_odds(a + 1, b, need) - series_odds(a, b + 1, need)) * .5 ** after, gt, n]
            if x: w[x] = w.get(x, 0) + 1
    return out


def cap(y):  # the most one regular-season game can be worth in title odds that year
    return 0 if y == 1994 else .5 if y < 1969 else .25 if y < 1995 else .125


def title_odds(y, Wn, lg, dv):  # sims x teams standings (with tie-break noise) -> each team's title odds
    T, ar = np.zeros(Wn.shape), np.arange(len(Wn))
    if y == 1994: return T
    for L in ('AL', 'NL'):
        cols = np.where(lg == L)[0]
        if not len(cols): continue
        if y < 1969: T[ar, cols[Wn[:, cols].argmax(1)]] = .5; continue
        divs = [cols[dv[cols] == d] for d in sorted(set(dv[cols]))]
        if y < 1995:
            for c in divs: T[ar, c[Wn[:, c].argmax(1)]] = .25
            continue
        Wl = Wn.copy(); seeds = []  # (team index per sim, title odds), best division winners first
        dw = np.stack([c[Wn[:, c].argmax(1)] for c in divs], 1)
        Wl[ar[:, None], dw] = -np.inf
        if y == 2020:  # top two in each division, then the two best of the rest
            sec = np.stack([c[Wl[:, c].argmax(1)] for c in divs], 1); Wl[ar[:, None], sec] = -np.inf
            seeds = [(t, 1 / 16) for t in [*dw.T, *sec.T]]
        elif y >= 2022:
            o = np.argsort(-Wn[ar[:, None], dw], 1); dw = dw[ar[:, None], o]
            seeds = [(dw[:, 0], 1 / 8), (dw[:, 1], 1 / 8), (dw[:, 2], 1 / 16)]
        else: seeds = [(t, 1 / 8) for t in dw.T]
        nwc = 0 if y < 1995 else 1 if y < 2012 else 2 if y < 2022 else 3
        wcp = 1 / 8 if y < 2012 else 1 / 16
        rest = cols[np.argsort(-Wl[:, cols], 1)[:, :nwc]]
        seeds += [(rest[:, j], wcp) for j in range(nwc)]
        for t, p in seeds: T[ar, t] = p
    return T


class Season:  # a regular season's schedule and results from the game logs, for playing out the rest of it
    def __init__(self, y, gl, divs):
        g = gl[(gl[4].isin(['AL', 'NL'])) & (gl[7].isin(['AL', 'NL']))].copy()
        self.y = y
        self.teams = sorted(set(g[3]) | set(g[6])); ix = {t: n for n, t in enumerate(self.teams)}
        lgs = {**dict(zip(g[3], g[4])), **dict(zip(g[6], g[7]))}
        self.lg = np.array([lgs[t] for t in self.teams]); self.dv = np.array([divs.get((t, y), '') for t in self.teams])
        self.date, self.h, self.v = g[0].astype(int).to_numpy(), g[6].map(ix).to_numpy(), g[3].map(ix).to_numpy()
        self.hw = (g[10] > g[9]).to_numpy(); self.vw = (g[9] > g[10]).to_numpy()
        self.gid = (g[6] + g[0].astype(str) + g[1].astype(str)).to_numpy(); self.row = {k: n for n, k in enumerate(self.gid)}
        self.day = {}

    def playout(self, d):  # sims x teams wins at season's end, playing every game from day d on as a coin flip
        if d not in self.day:
            nT, done = len(self.teams), self.date < d
            W0 = np.bincount(self.h[done & self.hw], minlength=nT) + np.bincount(self.v[done & self.vw], minlength=nT)
            rem = np.where(~done)[0]
            X = (np.random.default_rng(d).random((SIMS, len(rem))) < .5).astype(np.float32)
            Hi, Vi = np.zeros((len(rem), nT), np.float32), np.zeros((len(rem), nT), np.float32)
            Hi[np.arange(len(rem)), self.h[rem]] = 1; Vi[np.arange(len(rem)), self.v[rem]] = 1
            W = W0 + X @ Hi + (1 - X) @ Vi
            noise = np.random.default_rng(d + 1).random(W.shape) * .5
            self.day = {d: (W, X, {r: n for n, r in enumerate(rem)}, noise)}  # one day at a time: games come in date order
        return self.day[d]

    def gli(self, gid):
        r = self.row.get(gid)
        if r is None: return 0.
        W, X, col, noise = self.playout(self.date[r])
        h, v, x = self.h[r], self.v[r], X[:, col[r]]
        Wm = W.copy(); Wm[:, h] -= x; Wm[:, v] -= 1 - x
        Th = Wm.copy(); Th[:, h] += 1; Tv = Wm.copy(); Tv[:, v] += 1
        Th, Tv = title_odds(self.y, Th + noise, self.lg, self.dv), title_odds(self.y, Tv + noise, self.lg, self.dv)
        return ((Th[:, h] - Tv[:, h]).mean() + (Tv[:, v] - Th[:, v]).mean()) / 2


# ---------------------------------------------------------------- scoring
def weight(y, gt):  # gLI counts half in the Negro Leagues' postseason (every pre-1969 round but the World Series)
    return np.where((y < 1969) & ~pd.Series(gt).isin(['worldseries', 'regular']).to_numpy(), .5, 1)


def score(inn, ss9, ss, gli, maxl, lastl, wpa1, tie):
    return (inn + ss9 + ss - 1) * (.4 + maxl ** 3 + wpa1 * gli * gli ** 2) ** 2 * np.where(pd.isna(lastl), wpa1, lastl) ** .5 * gli


def season_rows(y, redo):
    f = CACHE / f'{y}.csv'
    if f.exists() and not redo: return pd.read_csv(f, dtype={'gid': str})
    zname = f'{y}csvs.zip'
    p, info = plays(zname), read(zname, 'gameinfo.csv', dtype={'gid': str})
    reg = info[info.gametype.isin(['regular', 'playoff'])]  # 'playoff': the tiebreakers, played out with the season
    p = p[p.gid.isin(reg.gid)]
    o = game_stats(p, reg, Env(run_counts(p)), ghost=y >= 2020).reset_index()
    o.to_csv(f, index=False)
    return o


def main(redo=False):
    CACHE.mkdir(parents=True, exist_ok=True)
    years = [y for y in range(FIRST, LAST + 1) if (CSVD / f'{y}csvs.zip').exists()]
    if not years: sys.exit('No Retrosheet season files: run python scripts/fetch_retrosheet.py first')
    post_p, post_i = plays('postseason.zip'), read('postseason.zip', 'gameinfo.csv', dtype={'gid': str})
    ap, ai = api_post()
    if ap is not None: post_p, post_i = pd.concat([post_p, ap], ignore_index=True), pd.concat([post_i, ai], ignore_index=True)
    counts = {}
    for y in years:  # each season's run scoring (cached alongside its games)
        f = CACHE / f'{y}.runs.npy'
        if f.exists() and not redo: counts[y] = np.load(f)
        else:
            counts[y] = run_counts(plays(f'{y}csvs.zip')); np.save(f, counts[y])
        print(f'  {y} run scoring', end='\r', flush=True)
    allc = sum(counts.values()); Env.BASE = allc / allc.sum(1, keepdims=True)

    rows = []
    for y in years:
        o = season_rows(y, redo); o['y'] = y; o['gt'] = 'regular'; rows.append(o)
        print(f'  {y}: {len(o)} games', end='\r', flush=True)
    # the postseason, with the season's (or the nearest season's) run scoring
    pg = post_gli(post_i)
    post_i['y'] = post_i.date.astype(str).str[:4].astype(int)
    for y, inf in post_i.groupby('y'):
        pp = post_p[post_p.gid.isin(inf.gid)]
        if pp.empty: continue
        o = game_stats(pp, inf, Env(counts[min(years, key=lambda z: abs(z - y))]), ghost=False)
        if len(o): rows.append(o.reset_index().assign(y=y, gt=lambda d: d.gid.map(lambda g: pg[g][1]), n=lambda d: d.gid.map(lambda g: pg[g][2])))
    G = pd.concat(rows, ignore_index=True)
    G['gli'] = G.gid.map(lambda g: pg[g][0] if g in pg else np.nan) * weight(G.y.to_numpy(), G['gt'].to_numpy())
    print(f'\n{len(G)} games with play-by-play ({(G["gt"] != "regular").sum()} postseason)')

    # regular-season gLI: play out the schedule only where it could matter, best case first, until no game left could
    # reach the top KEEP (the score only grows with gLI, so the season's cap bounds it)
    reg = G["gt"] == "regular"
    ub = score(G.inn, G.ss9, G.ss, G.y.map(cap), G.maxl, G.lastl, G.wpa1, G.tie)
    best = list(score(G.inn, G.ss9, G.ss, G.gli, G.maxl, G.lastl, G.wpa1, G.tie)[~reg].nlargest(KEEP))
    heapq.heapify(best)
    gl = {}
    with zipfile.ZipFile(RET / 'gl1871_2025.zip') as z:
        for y in years: gl[y] = pd.read_csv(z.open(f'gl{y}.txt'), header=None, usecols=[0, 1, 3, 4, 6, 7, 9, 10], dtype={1: str})
    T = pd.read_csv(ROOT / 'data' / 'lahman' / 'Teams.csv', encoding='utf-8-sig')
    divs = {(r.teamIDretro, r.yearID): r.divID if isinstance(r.divID, str) else '' for r in T.itertuples()}
    seasons, n = {}, 0
    order = ub[reg].sort_values(ascending=False)
    todo = G.loc[order.index]
    todo = todo[order > 0]
    # work season by season, in date order, so each day's playouts are reused
    picked = [k for k, u in zip(todo.index, order[order > 0]) if u >= best[0]]  # a first pass; the bound tightens below
    for y, ks in todo.loc[picked].groupby('y').groups.items():
        s = seasons.setdefault(y, Season(y, gl[y], divs))
        for k in sorted(ks, key=lambda k: G.at[k, 'gid'][3:11]):
            if ub[k] < best[0]: G.at[k, 'gli'] = np.nan; continue
            G.at[k, 'gli'] = s.gli(G.at[k, 'gid']); n += 1
            sc = score(G.at[k, 'inn'], G.at[k, 'ss9'], G.at[k, 'ss'], G.at[k, 'gli'], G.at[k, 'maxl'], G.at[k, 'lastl'], G.at[k, 'wpa1'], G.at[k, 'tie'])
            if sc > best[0]: heapq.heapreplace(best, sc)
        print(f'  {y}: {n} regular-season games played out', end='\r', flush=True)
    print()
    G = G[G.gli.notna()].copy()
    G['cwpa1'] = G.wpa1 * G.gli
    G['score'] = score(G.inn, G.ss9, G.ss, G.gli, G.maxl, G.lastl, G.wpa1, G.tie)
    G = G.sort_values('score', ascending=False).head(KEEP)
    G['date'] = G.gid.str[3:11]
    cols = ['gid', 'y', 'date', 'gt', 'n', 'v', 'h', 'vr', 'hr', 'inn', 'ss9', 'ss', 'gli', 'maxl', 'lastl', 'cwpa1', 'wpa1', 'tie', 'score', 'twpa', 'wpa2', 'wpa3', 'wpa4', 'wpa5']
    G[cols].round(4).to_csv(OUT, index=False)
    print(f'wrote {OUT.relative_to(ROOT)}: the top {len(G)} games ({n} regular-season races played out)')


if __name__ == '__main__':
    main('--redo' in sys.argv)
