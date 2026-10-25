"use strict";
/* Living Atlas of Baseball
   Data: data/atlas.json (built by scripts/build_data.py), data/photos.json (scripts/fetch_photos.py),
   data/progress.json (your exported check-offs, committed), plus whatever this browser has saved. */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const getJSON = (u, fallback) => fetch(u).then(r => r.ok ? r.json() : fallback).catch(() => fallback);

let ROSTERS = null, rosterLoad = null, BOXES = null, boxLoad = null;  // + data/games.json (line scores), on first game page  // data/rosters.json, fetched when a team page first opens
let D, WORLD, STATES, PHOTOS = {}, NOTES = { pre: [], years: {}, decades: {}, players: {} };
const LG = { NA: 'National Association', NL: 'National League', AL: 'American League', AA: 'American Association', UA: 'Union Association', PL: "Players' League", FL: 'Federal League', NNL: 'Negro National League', NN2: 'Negro National League (II)', ECL: 'Eastern Colored League', ANL: 'American Negro League', EWL: 'East-West League', NSL: 'Negro Southern League', NAL: 'Negro American League', EAS: 'Eastern independent clubs', WES: 'Western independent clubs', IND: 'Independent clubs', NAC: 'Negro American (Cuban) clubs', INT: 'Interracial independents' };
const POSP = new Set(['SP', 'RP']);
const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'SP', 'RP'];
const nameOf = p => p.f + ' ' + p.l;
const initials = p => (p.f[0] || '') + (p.l[0] || '');
const ordinal = n => { n = +n; const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const rankLabel = p => p.ovr ? `#${p.ovr} ${p.pos}` : typeof p.prk === 'number' ? `${p.pos} #${p.prk}` : `${p.prk || ''} ${p.pos}`;
const wpct = t => (t.w + t.l) ? t.w / (t.w + t.l) : 0;

/* ================================================================ saving
   Everything you do is kept in this browser, and (once you connect GitHub) saved right away to
   progress.json on the repo's `progress` branch, which every browser reads when it opens the site.
   Without a token, Export gives you a file to keep. Entries merge per page: the newer one wins. */
const LS = 'atlas-progress-v1', GHK = 'atlas-gh-token', BAK = 'atlas-backed-up';
const GH = { repo: 'dc421/baseball-atlas', branch: 'progress', path: 'progress.json' };
const STORE = { progress: {} };
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } };
function mergeIn(src) {  // -> how many pages changed
  let n = 0;
  for (const [k, v] of Object.entries(src?.progress || {})) if (!STORE.progress[k] || (v.at || 0) > (STORE.progress[k].at || 0)) { STORE.progress[k] = v; n++; }
  return n;
}
const latest = src => Math.max(0, ...Object.values(src?.progress || {}).map(v => v.at || 0));
function loadStore(...saved) {  // committed and synced copies, then this browser's
  for (const src of saved) mergeIn(src);
  if (!lsGet(BAK)) lsSet(BAK, String(Math.max(...saved.map(latest), 0)));  // what came from a saved copy is already safe
  try { const local = JSON.parse(lsGet(LS) || 'null'); if (local) mergeIn(local); } catch (e) { }
}
let saveT = null, rev = 0;
function persist(sync = true) {
  clearTimeout(saveT); if (sync) rev++;
  saveT = setTimeout(() => {
    try { localStorage.setItem(LS, JSON.stringify({ ...STORE, savedAt: Date.now() })); }
    catch (e) { setNote('This browser isn’t letting the atlas save. Use Export to keep a copy.'); }
  }, 250);
  if (sync) scheduleSync(); syncUI();
}
const unbacked = () => { const t = +(lsGet(BAK) || 0); return Object.values(STORE.progress).filter(v => (v.at || 0) > t).length; };

/* ---------------------------------------------------------------- GitHub sync */
const ghToken = () => lsGet(GHK);
const ghAPI = (path, o = {}) => fetch(`https://api.github.com/repos/${GH.repo}${path ? '/' + path : ''}`, { cache: 'no-store', ...o,
  headers: { Authorization: `Bearer ${ghToken()}`, Accept: 'application/vnd.github+json', ...(o.headers || {}) } });
const b64 = str => { const b = new TextEncoder().encode(str); let t = ''; for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(t); };
const ghFail = r => { const e = new Error(r.status === 401 ? 'GitHub didn’t accept the token' : r.status === 403 || r.status === 404 ? 'The token can’t write to the repo' : 'GitHub said ' + r.status); e.status = r.status; return e; };
const SYNC = { state: 'idle', at: 0, err: '' };
let syncT = null, syncing = false, ghSha = null;  // ghSha: the file as this browser last read or wrote it
async function ghRead() {  // -> { sha, data }; sha is null before the first save
  const url = `contents/${GH.path}?ref=${GH.branch}`, r = await ghAPI(url);
  if (r.status === 404) return { sha: null, data: {} };
  if (!r.ok) throw ghFail(r);
  const j = await r.json(), raw = await ghAPI(url, { headers: { Accept: 'application/vnd.github.raw' } });
  if (!raw.ok) throw ghFail(raw);
  ghSha = j.sha;
  return { sha: j.sha, data: await raw.json() };
}
async function ghCreate(body, message) {  // first save: a branch of its own holding just progress.json
  const post = async (path, data) => { const r = await ghAPI(path, { method: 'POST', body: JSON.stringify(data) }); if (!r.ok) throw ghFail(r); return r.json(); };
  const tree = await post('git/trees', { tree: [{ path: GH.path, mode: '100644', type: 'blob', content: body }] });
  const commit = await post('git/commits', { message, tree: tree.sha, parents: [] });
  await post('git/refs', { ref: 'refs/heads/' + GH.branch, sha: commit.sha });
}
function scheduleSync(ms = 2000) {
  if (!ghToken()) return;
  clearTimeout(syncT); SYNC.state = 'pending'; syncT = setTimeout(ghSave, ms);
}
async function ghSave() {
  if (!ghToken()) return;
  if (syncing) return scheduleSync();
  clearTimeout(syncT); syncing = true; SYNC.state = 'saving'; syncUI();
  const r0 = rev;
  try {
    for (let tries = 0; ; tries++) {
      // write straight over the copy we last saw; only read first when we haven't seen it or another device has saved since
      if (!ghSha) {
        const remote = await ghRead();
        if (mergeIn(remote.data)) { persist(false); refreshMap(); if (!document.activeElement?.matches('input,textarea')) render(false); }
        if (remote.sha && JSON.stringify(remote.data.progress || {}) === JSON.stringify(STORE.progress)) break;  // nothing new to save
      }
      const body = JSON.stringify({ progress: STORE.progress, savedAt: new Date().toISOString() }, null, 1);
      const message = `Progress: ${Object.values(STORE.progress).filter(v => v.done).length} pages complete`;
      if (!ghSha) { await ghCreate(body, message); break; }  // first save ever (the next one reads the new file's sha)
      const r = await ghAPI(`contents/${GH.path}`, { method: 'PUT', keepalive: body.length < 60000,
        body: JSON.stringify({ message, content: b64(body), sha: ghSha, branch: GH.branch }) });
      if (r.ok) { ghSha = (await r.json()).content?.sha || null; break; }
      if ((r.status === 409 || r.status === 422) && tries < 3) { ghSha = null; continue; }  // another device saved in between: read, merge, write again
      throw ghFail(r);
    }
    lsSet(BAK, String(Date.now())); Object.assign(SYNC, { state: 'saved', at: Date.now(), err: '' });
  } catch (e) {
    Object.assign(SYNC, { state: 'error', err: e.message || 'Couldn’t reach GitHub' });
    if (e.status !== 401 && e.status !== 403) scheduleSync(60000);  // offline or GitHub hiccup: try again in a minute
  }
  syncing = false; syncUI(); refreshSaveBox();
  if (rev !== r0 && SYNC.state === 'saved') scheduleSync();
}
async function ghPull() {  // on load: the synced copy (fresh with a token, otherwise the public file, which can lag a few minutes)
  if (!ghToken()) return getJSON(`https://raw.githubusercontent.com/${GH.repo}/${GH.branch}/${GH.path}`, {});
  try { const r = await ghRead(); SYNC.state = 'saved'; SYNC.at = Date.now(); return r.data; }
  catch (e) { Object.assign(SYNC, { state: 'error', err: e.message }); return {}; }
}
async function ghConnect(token) {
  lsSet(GHK, token);
  const r = await ghAPI('').catch(() => null);
  if (!r || !r.ok || !(await r.json()).permissions?.push) { lsSet(GHK, null); throw new Error(r && r.status === 401 ? 'GitHub didn’t accept that token.' : 'That token can’t write to ' + GH.repo + '.'); }
  await ghSave();
}
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' hr ago' : Math.round(s / 86400) + ' days ago'; };
function syncUI() {  // the header pill: whether your progress is safe
  const b = $('#syncbtn'); if (!b) return;
  const n = unbacked(), tok = ghToken(), st = tok ? SYNC.state : n ? 'unsaved' : 'idle';
  const label = { pending: 'Saving…', saving: 'Saving…', saved: 'Saved', error: 'Not saved', unsaved: 'Back up', idle: '' }[st];
  b.hidden = !label; b.dataset.st = st; b.querySelector('span').textContent = label;
  b.title = st === 'error' ? SYNC.err + '. Open the save settings.' : st === 'unsaved' ? `${n} page${n === 1 ? '' : 's'} changed and only saved in this browser. Connect GitHub or export a copy.`
    : st === 'saved' ? 'Progress saved to GitHub' + (SYNC.at ? ' ' + ago(SYNC.at) : '') : 'Saving progress to GitHub';
}
const prog = key => STORE.progress[key];
function mutate(key, fn) {
  const cur = structuredClone(STORE.progress[key] || {});
  fn(cur); cur.at = Date.now(); STORE.progress[key] = cur; persist(); refreshMap(); render(false);
}
let note = '';
function setNote(t) { note = t; const b = $('#dbnote'); if (b) { b.textContent = t; b.hidden = !t; } }

/* ================================================================ entities */
function ent(key) {
  const t = key[0], id = key.slice(2);
  if (t === 'p' && D.players[id]) return { type: 'p', id, o: D.players[id] };
  if (t === 't' && D.teams[id]) return { type: 't', id, o: D.teams[id] };
  if (t === 'g' && D.games[id]) return { type: 'g', id, o: D.games[id] };
  if (t === 'f' && D.franch[id]) return { type: 'f', id, o: D.franch[id] };
  return null;
}
function fromOf(k) { const p = D.players[k]; const ov = prog('p_' + k)?.from; return ov || (p.from ? { ...p.from, ll: p.ll } : null); }

/* ---------------- doors ---------------- */
const yt = q => 'https://www.youtube.com/results?search_query=' + enc(q);
const img = q => 'https://www.google.com/search?tbm=isch&q=' + enc(q);
const gg = q => 'https://www.google.com/search?q=' + enc(q);
const wiki = q => 'https://en.wikipedia.org/w/index.php?search=' + enc(q);
const sabr = q => 'https://sabr.org/?s=' + enc(q);
const loc = q => 'https://www.loc.gov/collections/chronicling-america/?q=' + enc(q);
const books = q => 'https://www.google.com/search?tbm=bks&q=' + enc(q);
function doorsFor(key) {
  const e = ent(key); if (!e) return [];
  const o = e.o;
  if (e.type === 'p') {
    const n = nameOf(o), old = (o.pk || 2000) < 1925;
    const br = o.br ? `https://www.baseball-reference.com/players/${o.br[0]}/${o.br}.shtml` : `https://www.baseball-reference.com/search/search.fcgi?search=${enc(n)}`;
    return [
      { id: 'video', g: 'see', label: 'Highlights', hint: 'YouTube', url: yt(n + (old ? ' baseball footage' : ' highlights')) },
      { id: 'photos', g: 'see', label: 'Photos', hint: 'when there’s no film', url: img(n + ' baseball ' + (o.pk || '')) },
      { id: 'interview', g: 'see', label: 'Interview or voice', hint: 'YouTube', url: yt(n + ' interview') },
      { id: 'sabr', g: 'read', label: 'SABR biography', hint: 'BioProject', url: sabr(n) },
      { id: 'wiki', g: 'read', label: 'Wikipedia', hint: 'quick overview', url: wiki(n + ' baseball') },
      { id: 'news', g: 'read', label: 'Old newspapers', hint: 'Chronicling America', url: loc(n) },
      { id: 'book', g: 'read', label: 'A biography', hint: 'Google Books', url: books(n + ' biography') },
      { id: 'stats', g: 'nums', label: 'Baseball-Reference', hint: 'full stat pages', url: br },
    ];
  }
  if (e.type === 't') {
    const n = `${o.y} ${o.n}`, park = o.pk && D.parks[o.pk];
    const major = ['NA', 'NL', 'AL', 'AA', 'UA', 'PL', 'FL'].includes(o.lg);
    const out = [
      { id: 'photos', g: 'see', label: 'Team photo', hint: 'images', url: img(n + ' team photo') },
      { id: 'video', g: 'see', label: 'Film or highlights', hint: 'YouTube', url: yt(n) },
      { id: 'wiki', g: 'read', label: 'Season story', hint: 'Wikipedia', url: wiki(n + ' season') },
      { id: 'sabr', g: 'read', label: 'SABR', hint: 'team histories', url: sabr(n) },
      { id: 'news', g: 'read', label: 'Old newspapers', hint: 'Chronicling America', url: loc(o.n + ' ' + o.y) },
      { id: 'stats', g: 'nums', label: 'Roster & stats', hint: 'Baseball-Reference', url: major && o.br ? `https://www.baseball-reference.com/teams/${o.br}/${o.y}.shtml` : gg(n + ' baseball-reference') },
    ];
    const pn = park ? park.n : o.park;
    if (pn) out.push({ id: 'park', g: 'see', label: 'The ballpark', hint: pn, url: img(pn + ' ' + (park ? park.c : '') + ' ballpark ' + o.y) },
      { id: 'diagram', g: 'nums', label: 'Park diagram', hint: 'Clem’s Baseball', url: gg('site:andrewclem.com ' + pn) });
    return out;
  }
  if (e.type === 'f') {
    const last = D.teams[o.s[o.s.length - 1]], n = o.n;
    return [
      { id: 'photos', g: 'see', label: 'Photos through the years', hint: 'images', url: img(n + ' baseball history') },
      { id: 'video', g: 'see', label: 'Film', hint: 'YouTube', url: yt(n + ' history') },
      { id: 'wiki', g: 'read', label: 'Franchise history', hint: 'Wikipedia', url: wiki(n + ' baseball franchise history') },
      { id: 'sabr', g: 'read', label: 'SABR', hint: 'team histories', url: sabr(n) },
      { id: 'stats', g: 'nums', label: 'Franchise index', hint: 'Baseball-Reference', url: last.br ? `https://www.baseball-reference.com/teams/${last.br}/` : gg(n + ' baseball-reference') },
    ];
  }
  if (e.type === 'g') {
    const n = `${o.y} ${o.g} ${o.d || ''}`.trim();
    return [
      { id: 'video', g: 'see', label: 'Watch it', hint: 'YouTube', url: yt(n) },
      { id: 'photos', g: 'see', label: 'Photos', hint: 'images', url: img(n) },
      { id: 'read', g: 'read', label: 'The story', hint: 'SABR Games Project', url: sabr(o.y + ' ' + o.g) },
      { id: 'news', g: 'read', label: 'Next-day papers', hint: 'Chronicling America', url: loc(o.y + ' ' + (o.d || o.g)) },
      { id: 'stats', g: 'nums', label: 'Box score', hint: 'search', url: gg(n + ' box score baseball-reference') },
    ];
  }
  return [];
}
function doorState(key) { const base = key.startsWith('p_') ? (D.players[key.slice(2)]?.base || {}) : {}; return { ...base, ...(prog(key)?.doors || {}) }; }
function lights(key) {
  const ds = doorState(key), d = prog(key) || {}, on = { see: false, read: false, nums: false };
  for (const dr of doorsFor(key)) if (ds[dr.id]) on[dr.g] = true;
  for (const c of d.clips || []) { if (c.k === 'video') on.see = true; else if (c.k !== 'link') on.read = true; }
  return on;
}
// a page is done when you mark it complete (the checkbox on each tracked page); everything starts incomplete
const isDone = key => !!prog(key)?.done;
const litN = key => isDone(key) ? 3 : 0;
// tracked pages: your players, the top team seasons (one per season played, the 1869 Red Stockings included), as many of your top games,
// each of those seasons' year pages, every decade (before 1871 is one), the US states and other countries your players
// are from, and every franchise
function trackKeys() {
  const P = Object.keys(D.players).map(k => 'p_' + k);
  const T = Object.entries(D.teams).filter(([, t]) => t.top).sort((a, b) => a[1].y - b[1].y).map(([k]) => 't_' + k);
  const G = Object.values(D.games).filter(g => !g.o).sort((a, b) => a.rk - b.rk).slice(0, T.length).map(g => 'g_' + g.rk);
  const Y = [...new Set(Object.values(D.teams).map(t => t.y))].sort((a, b) => a - b).map(y => 'y_' + y);  // every season since 1869
  const Dc = ['d_pre', ...Array.from({ length: 16 }, (_, i) => 'd_' + (1870 + 10 * i))];
  if (!PL) buildPlaces();
  // places of origin: US states, and every other country (no cities)
  const Pl = Object.values(PL).filter(nd => nd.from.length && (nd.n === 'United States' ? nd.lvl === 1 : nd.lvl === 0)).map(nd => 'l_' + nd.k);
  const F = Object.keys(D.franch).map(k => 'f_' + k);
  return { P, T, G, Y, Dc, Pl, F, all: new Set([...P, ...T, ...G, ...Y, ...Dc, ...Pl, ...F]) };
}
const doneHTML = key => trackKeys().all.has(key)
  ? `<button class="donebtn" data-done="${esc(key)}" aria-pressed="${isDone(key)}"><span class="box" aria-hidden="true"></span>${isDone(key) ? 'Complete' : 'Mark complete'}</button>` : '';

/* ================================================================ places index */
const placeKey = (pl, lvl) => lvl === 0 ? pl.n : lvl === 1 ? `${pl.n}|${pl.r || '—'}` : `${pl.n}|${pl.r || '—'}|${pl.c || '—'}`;
let PL = null;
function buildPlaces() {
  PL = {};
  const node = (pl, lvl) => { const k = placeKey(pl, lvl); return PL[k] = PL[k] || { k, lvl, n: pl.n, r: pl.r, c: pl.c, from: [], played: new Map(), teams: [], lls: [] }; };
  for (const k of Object.keys(D.players)) {
    const f = fromOf(k); if (!f || !f.n) continue;
    for (let l = 0; l < 3; l++) { const nd = node(f, l); nd.from.push(k); if (f.ll) nd.lls.push(f.ll); }
  }
  for (const [tid, t] of Object.entries(D.teams)) {
    if (!t.pl || !t.pl.n) continue;
    for (let l = 0; l < 3; l++) {
      const nd = node(t.pl, l); nd.teams.push(tid); if (t.ll && l === 2 && !nd.lls.length) nd.lls.push(t.ll);
      for (const pk of t.ro || []) { const x = nd.played.get(pk) || { y0: t.y, y1: t.y, tm: new Set() }; x.y0 = Math.min(x.y0, t.y); x.y1 = Math.max(x.y1, t.y); x.tm.add(t.n); nd.played.set(pk, x); }
    }
  }
}
function placeLabel(nd) { return nd.lvl === 0 ? nd.n : nd.lvl === 1 ? (nd.r === '—' || !nd.r ? nd.n : nd.r) : (nd.c || '—'); }

/* ================================================================ map */
let svg, gRoot, gLand, gBase, gFocus, gLab, proj, path, W = 800, H = 600, K = 1;
const zoom = d3.zoom().scaleExtent([1, 80]).on('zoom', ev => { gRoot.attr('transform', ev.transform); K = ev.transform.k; rescale(); });
function setupMap() {
  svg = d3.select('#map'); gRoot = svg.append('g'); gLand = gRoot.append('g'); gBase = gRoot.append('g'); gFocus = gRoot.append('g'); gLab = gRoot.append('g');
  svg.call(zoom); sizeMap();
}
function sizeMap() {
  const r = $('#map').getBoundingClientRect(); W = r.width || 800; H = r.height || 500;
  proj = d3.geoNaturalEarth1().fitExtent([[0, 0], [W, H]], { type: 'Sphere' }); path = d3.geoPath(proj);
  gLand.selectAll('*').remove();
  gLand.append('path').datum(topojson.feature(WORLD, WORLD.objects.countries)).attr('class', 'land').attr('d', path);
  gLand.append('path').datum(topojson.mesh(STATES, STATES.objects.states, (a, b) => a !== b)).attr('class', 'states').attr('d', path);
}
const XY = ll => proj([ll[1], ll[0]]);
const sc = () => 1 / Math.pow(K, 0.75);
function rescale() {
  const s = sc();
  gBase.selectAll('g.badge-t').attr('transform', d => `translate(${d.x + d.ox * s},${d.y + d.oy * s}) scale(${s})`);
  gBase.selectAll('circle.dot').attr('r', d => d.r * s).attr('stroke-width', s);
  gFocus.selectAll('circle').attr('r', d => d.r * s).attr('stroke-width', 1.5 * s);
  gLab.selectAll('text').attr('font-size', 11 * s).attr('stroke-width', 3 * s).attr('dx', 9 * s).attr('dy', -9 * s);
}
const fillFor = n => n === 0 ? 'var(--ghost)' : `color-mix(in srgb,var(--lit) ${40 + n * 20}%,var(--ghost))`;
let YEAR = 1897, MAPMODE = 'teams', highlight = null, focusPts = null;

function logoFor(t) {
  if (!D.logos.length) return null;
  let best = null, bestScore = -1;
  for (const f of D.logos) {
    const m = f.match(/^([A-Za-z0-9]+)(?:[_-](\d{4}))?\.\w+$/); if (!m) continue;
    const code = m[1].toUpperCase(), yr = m[2] ? +m[2] : 0;
    const rank = code === (t.br || '').toUpperCase() || code === t.tm ? 2 : code === t.fr ? 1 : -1;
    if (rank < 0 || yr > t.y) continue;
    const score = rank * 10000 + yr;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return best && !best.endsWith('.none') ? best : null;
}
function teamColors(t) { const c = D.franch[t.fr]?.col; return c || ['#53635b', '#eef1ea']; }

function drawBase() {
  gBase.selectAll('*').remove();
  const s = sc();
  if (MAPMODE === 'teams') {
    const byLL = {};
    for (const [tid, t] of Object.entries(D.teams)) { if (t.y !== YEAR || !t.ll) continue; (byLL[t.ll.join()] = byLL[t.ll.join()] || []).push(tid); }
    const items = [];
    for (const tids of Object.values(byLL)) tids.forEach((tid, i) => {
      const t = D.teams[tid], [x, y] = XY(t.ll), a = i * 2 * Math.PI / tids.length, off = tids.length > 1 ? 12 : 0;
      items.push({ tid, t, x, y, ox: off * Math.sin(a), oy: -off * Math.cos(a) });
    });
    const g = gBase.selectAll('g.badge-t').data(items).enter().append('g').attr('class', 'badge-t pin').style('cursor', 'pointer')
      .on('click', (ev, d) => go('t_' + d.tid));
    g.each(function (d) {
      const el = d3.select(this), lit = litN('t_' + d.tid), [bg, fg] = teamColors(d.t), sel = highlight === 't_' + d.tid;
      const logo = logoFor(d.t);
      el.append('circle').attr('r', sel ? 13 : 10.5).attr('fill', logo ? '#fff' : bg)
        .attr('stroke', lit || sel ? 'var(--lit)' : 'var(--water)').attr('stroke-width', lit || sel ? 2.5 : 1.2)
        .style('filter', lit ? 'drop-shadow(0 0 4px var(--lit))' : null);
      if (logo) el.append('image').attr('href', 'logos/' + logo).attr('x', -8).attr('y', -8).attr('width', 16).attr('height', 16);
      else el.append('text').attr('fill', fg).attr('font-size', (d.t.br || d.t.tm).length > 2 ? 6.4 : 7.5).text(d.t.br || d.t.tm);
      el.attr('opacity', highlight && !sel ? .45 : 1);
      el.append('title').text(`${d.t.y} ${d.t.n}`);
    });
  } else if (MAPMODE === 'players') {
    for (const k of Object.keys(D.players)) {
      const f = fromOf(k); if (!f || !f.ll) continue; const [x, y] = XY(f.ll);
      gBase.append('circle').datum({ r: 3.6 }).attr('class', 'dot pin').attr('cx', x).attr('cy', y).attr('fill', fillFor(litN('p_' + k)))
        .attr('fill-opacity', highlight && highlight !== 'p_' + k ? .35 : .95).attr('stroke', 'var(--water)').on('click', () => go('p_' + k))
        .append('title').text(nameOf(D.players[k]) + ' — from ' + (f.c || f.r || f.n));
    }
  } else if (MAPMODE === 'places') {
    for (const nd of Object.values(PL)) {
      if (nd.lvl !== 2 || !nd.lls.length) continue;
      const n = nd.from.length + Math.min(nd.teams.length, 30) / 10; if (!n) continue;
      const [x, y] = XY(nd.lls[0]); const inSel = !placeSel || nd.k.startsWith(placeSel);
      gBase.append('circle').datum({ r: 2.5 + Math.sqrt(n) * 1.8 }).attr('class', 'dot pin').attr('cx', x).attr('cy', y)
        .attr('fill', nd.from.some(k => litN('p_' + k)) ? 'var(--lit)' : 'var(--ghost)').attr('fill-opacity', inSel ? .85 : .2)
        .attr('stroke', 'var(--water)').on('click', () => go('l_' + enc(nd.k)))
        .append('title').text(`${nd.c}, ${nd.r && nd.r !== '—' ? nd.r + ', ' : ''}${nd.n}: ${nd.from.length} from here, ${nd.teams.length} team seasons`);
    }
  }
  rescale();
}
function drawFocus() {
  gFocus.selectAll('*').remove(); gLab.selectAll('*').remove();
  if (!focusPts || !focusPts.length) return;
  const pts = focusPts.map(p => ({ ...p, r: p.r || 6 }));
  gFocus.selectAll('circle').data(pts).enter().append('circle').attr('class', 'pin')
    .attr('cx', d => XY(d.ll)[0]).attr('cy', d => XY(d.ll)[1]).attr('fill', d => d.key ? fillFor(litN(d.key)) : 'var(--lit)').attr('stroke', 'var(--chalk)')
    .on('click', (ev, d) => d.key && go(d.key)).append('title').text(d => d.label);
  const seen = new Set();
  gLab.selectAll('text').data(pts.filter(p => { const k = p.ll.join(); if (seen.has(k)) return false; seen.add(k); return true; })).enter().append('text').attr('class', 'maplabel')
    .attr('x', d => XY(d.ll)[0]).attr('y', d => XY(d.ll)[1]).text(d => d.label);
  rescale();
}
function fitTo(lls, maxK = 30) {
  if (!lls.length) return;
  const xs = lls.map(XY); let [x0, x1] = d3.extent(xs, d => d[0]), [y0, y1] = d3.extent(xs, d => d[1]);
  const pad = Math.max(24, Math.min(W, H) * .1), bar = $('#mapbar').hidden ? 0 : 56;  // the year pill floats over the top of the map
  const k = Math.min(maxK, Math.min((W - 2 * pad) / Math.max(x1 - x0, 20), (H - 2 * pad - bar) / Math.max(y1 - y0, 20)));
  const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
  svg.transition().duration(reduce ? 0 : 600).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - k * (x0 + x1) / 2, (H + bar) / 2 - k * (y0 + y1) / 2).scale(k));
}
const fitNorthAmerica = () => fitTo([[50, -125], [17, -66]], 6);
function refreshMap() { drawBase(); drawFocus(); }
function setYear(y) {
  YEAR = Math.max(1845, Math.min(2025, y | 0)); $('#yr').value = YEAR; $('#bigyear').textContent = YEAR;
  if (view.type === 'y') { view = { type: 'y', id: String(YEAR) }; setHash(); render(true, { keepMap: true }); } else drawBase();
}

/* ================================================================ routing
   Four homes (map, teams, players, games) each remember where you left them; every other view is a page.
   Each page you open is a browser history entry (state.d = how deep you are, state.sc = where you'd scrolled),
   so the browser's back and forward buttons and swipes work like the ← Back button. */
let view = { type: 'y', id: '1897' };
const HOMES = ['map', 'teams', 'players', 'games', 'tracker'];
const homeOf = v => 'yld'.includes(v.type) ? 'map' : v.type === 'r' ? v.id : null;
const layoutOf = v => 'yld'.includes(v.type) ? 'map' : v.type === 'r' ? 'list' : 'page';
let lastHome = 'map', lastMap = { type: 'y', id: '1897' }, mapT = null, FULL = false, sizedFor = '';
const homeScroll = {};
const hashOf = v => '#' + v.type + '-' + v.id;
const setHash = () => { try { history.replaceState(history.state, '', hashOf(view)); } catch (e) { } };
const depth = () => history.state?.d || 0;
function viewFromHash() {
  const m = (location.hash || '').slice(1).match(/^([ptgfcyarld])-(.+)$/); if (!m) return null;
  const pk = pageKey(m[1] + '_' + m[2]);
  return { type: pk[0], id: pk[0] === 'r' && !HOMES.includes(pk.slice(2)) ? 'players' : pk.slice(2) };
}
const scroller = () => innerWidth <= 820 ? document.scrollingElement : $('#panel');
function leave() {  // remember the home we're leaving
  const h = homeOf(view); if (!h) return;
  if (h === 'map') { lastMap = view; mapT = d3.zoomTransform(svg.node()); } else homeScroll[h] = scroller().scrollTop;
}
// only tracked team seasons have pages (the top ones by your model, one per season played); any other season opens its franchise
const pageKey = key => { if (key.startsWith('t_')) { const t = D.teams[key.slice(2)]; if (t && !t.top) return 'f_' + t.fr; } return key; };
function go(key, push = true) {
  key = pageKey(key);
  stopPlay(); leave(); setFull(false, false);
  const d = depth();
  try { history.replaceState({ d, sc: scroller().scrollTop }, ''); } catch (e) { }
  view = { type: key[0], id: key.slice(2) };
  try { history[push ? 'pushState' : 'replaceState']({ d: push ? d + 1 : d }, '', hashOf(view)); } catch (e) { }
  render(true);
  scroller().scrollTop = 0;
}
function goHome(h) {
  if (h === 'map') { go(lastMap.type + '_' + lastMap.id); return render(true, { restore: true }); }
  go('r_' + h);
  if (homeScroll[h]) scroller().scrollTop = homeScroll[h];
}
const back = () => history.back();
function onPop(e) {  // the browser moved through history: show that page, scrolled where you left it
  const v = viewFromHash(); if (!v) return;
  stopPlay(); leave(); setFull(false, false);
  view = v; if (v.type === 'y') { YEAR = +v.id; $('#yr').value = YEAR; $('#bigyear').textContent = YEAR; }
  render(true, { restore: homeOf(v) === 'map' });
  const sc = e.state?.sc; scroller().scrollTop = sc != null ? sc : homeOf(v) && homeOf(v) !== 'map' ? homeScroll[homeOf(v)] || 0 : 0;
}
function setFull(on, redraw = true) {
  if (FULL === on) return; FULL = on; document.body.classList.toggle('mapfull', on);
  if (redraw) placeMap(false);
}
window.go = go;

/* ================================================================ shared bits */
const lightsHTML = key => { const l = lights(key); return `<div class="lights">${[['see', 'Seen'], ['read', 'Read'], ['nums', 'Numbers']].map(([k, t]) => `<span class="bulb ${l[k] ? 'on' : ''}"><i></i>${t}</span>`).join('')}</div>`; };
const dotsHTML = key => { const l = lights(key); return `<span class="dots" title="seen · read · numbers">${['see', 'read', 'nums'].map(k => `<i class="${l[k] ? 'on' : ''}"></i>`).join('')}</span>`; };
function doorsHTML(key) {
  const ds = doorState(key);
  return `<div class="doors">${doorsFor(key).map(d => `<div class="door ${ds[d.id] ? 'done' : ''}">
    <input type="checkbox" class="tick" id="d-${d.id}" data-door="${d.id}" ${ds[d.id] ? 'checked' : ''} aria-label="Mark ${esc(d.label)} done">
    <label for="d-${d.id}">${esc(d.label)}${d.hint ? `<small>${esc(d.hint)}</small>` : ''}</label>
    <a href="${esc(d.url)}" target="_blank" rel="noopener">Open ↗</a></div>`).join('')}</div>`;
}
const GR = ['Poor', 'Fair', 'Average', 'Good', 'Great', 'Elite'];
// your rating model's tools (20-80) pre-fill the card until you pick a grade yourself
const MODEL_TOOL = { Hit: 'hit_tool', Power: 'power', Run: 'speed', Field: 'fielding', Fastball: 'K_plus', Control: 'BB_plus', Durability: 'dur' };
const gradeOf80 = v => GR[v < 35 ? 0 : v < 45 ? 1 : v < 55 ? 2 : v < 65 ? 3 : v < 75 ? 4 : 5];
function gradesHTML(key, pitcher, mt = {}) {
  const tools = pitcher ? ['Fastball', 'Off-speed', 'Control', 'Durability', 'Hitting'] : ['Hit', 'Power', 'Discipline', 'Run', 'Field', 'Throw'];
  const g = prog(key)?.grades || {};
  return `<div class="grades">${tools.map(t => { const v = mt[MODEL_TOOL[t]], sg = !g[t] && v != null ? gradeOf80(v) : null;
    return `<div class="grade"><span>${t}${v != null ? ` <b class="m80" title="Your model, 20–80${t === 'Fastball' ? ' (from strikeout rate)' : ''}">${v}</b>` : ''}</span><div class="scale" data-tool="${t}">${GR.map(s => `<button type="button" aria-pressed="${g[t] === s}" ${sg === s ? 'class="sugg"' : ''} data-grade="${s}">${s}</button>`).join('')}</div></div>`; }).join('')}</div>`;
}
/* ================================================================ your rating model
   Scores are WAR/G above the era's comparison line, x1000 (scripts/export_ratings.R). */
const TIERS = [[6.9, 'All-timer'], [3, 'Safely in'], [0, 'Borderline in'], [-3, 'Borderline out'], [-Infinity, 'Out']];
const tierOf = s => TIERS.find(t => s > t[0])[1];
const fmtS = s => (s > 0 ? '+' : '') + s.toFixed(1);
function modelList(lst, mine) {
  return `<div class="list">${lst.map((e, i) => { const [nm, k, s, pos, tid] = e, inner = `<span class="yr">#${i + 1} ${esc(pos || '')}</span><span class="rn">${esc(nm)}${mine && mine.has(nm) ? ' <span class="badge gold">your top 5</span>' : ''}${tid && D.teams[tid] ? `<small>${esc(D.teams[tid].n)}</small>` : ''}</span><span class="meta">${fmtS(s)}</span>`;
    return k ? `<button class="row" onclick="go('p_${k}')">${inner}</button>` : tid ? `<button class="row" onclick="go('t_${tid}')">${inner}</button>` : `<div class="row" style="cursor:default">${inner}</div>`; }).join('')}</div>`;
}
function teamRankRow([tid, t], i, all = true) {
  const r = t.tr;
  return `<button class="row" onclick="go('t_${tid}')">${badgeSm(t)}<span class="yr">#${all ? r.ar : r.yr}</span><span class="rn">${t.y} ${esc(t.n)}<small>${t.w}–${t.l}${t.ws ? ' · won the World Series' : t.pen ? ' · pennant' : ''} · ${r.v} projected WAR${all ? ` · #${r.yr} of ${r.n} in ${t.y}` : ''}</small></span><span class="meta">${fmtS(r.a)}</span></button>`;
}
function rosterHTML(tid) {
  if (!ROSTERS) {
    rosterLoad = rosterLoad || getJSON('data/rosters.json', {}).then(r => { ROSTERS = r; if (view.type === 't') render(false); });
    return '<h2>Lineup</h2><p class="note">Loading the roster…</p>';
  }
  const r = ROSTERS[tid]; if (!r) return '';
  const nm = e => e[1] ? `<a href="#" onclick="go('p_${e[1]}');return false">${esc(e[0])}</a>` : esc(e[0]);
  const war = v => v == null ? '' : v.toFixed(1);
  const hit = rows => `<table class="stats roster"><tr><th>Pos</th><th class="nm">Player</th><th>G</th><th>HR</th><th>AVG</th><th>OBP</th><th>SLG</th><th title="Projected WAR for this team, per 162, from your model">WAR</th></tr>${rows.map(e => `<tr><td>${e[0]}</td><td class="nm">${nm(e.slice(1))}</td><td>${e[4]}</td><td>${e[5]}</td><td>${e[6]}</td><td>${e[7]}</td><td>${e[8]}</td><td>${war(e[3])}</td></tr>`).join('')}</table>`;
  const pit = (rows, rot) => `<table class="stats roster"><tr><th class="nm">Player</th><th>G</th><th>${rot ? 'GS' : 'SV'}</th><th>W–L</th><th>IP</th><th>ERA</th><th title="Projected WAR for this team, per 162, from your model">WAR</th></tr>${rows.map(e => `<tr><td class="nm">${nm(e)}</td><td>${e[3]}</td><td>${rot ? e[4] : e[7]}</td><td>${e[5]}–${e[6]}</td><td>${e[8]}</td><td>${e[9]}</td><td>${war(e[2])}</td></tr>`).join('')}</table>`;
  return `<h2>Lineup <small>most games at each position; WAR is your model’s, per 162</small></h2><div class="statline">${hit(r.L)}</div>
   ${r.R.length ? `<h2>Rotation</h2><div class="statline">${pit(r.R, true)}</div>` : ''}
   ${r.P.length ? `<h2>Bullpen</h2><div class="statline">${pit(r.P, false)}</div>` : ''}
   ${r.B.length ? `<h2>Bench</h2><div class="statline">${hit(r.B)}</div>` : ''}`;
}
/* ================================================================ tracker
   Everything counts only once you tick "Mark complete" on its page (see trackKeys for what's tracked). */
function vTracker() {
  const K = trackKeys(), done = keys => keys.filter(isDone).length;
  const types = [['Players', K.P, 'your list'], ['Team seasons', K.T, `the top ${K.T.length} by your model, one per season played (1869 included)`], ['Games', K.G, `your top ${K.G.length}`],
    ['Years', K.Y, 'every season since 1869'], ['Decades', K.Dc, 'before 1871 is one page'], ['Franchises', K.F, 'every franchise'], ['Places of origin', K.Pl, 'the US states and other countries your players are from']];
  const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
  const bar = (d, n) => `<div class="tbar" title="${d} of ${n} complete"><i class="d" style="width:${100 * d / (n || 1)}%"></i></div>`;
  const row = ([label, keys, note]) => { const d = done(keys); return `<tr><td>${label}${note ? `<small>${note}</small>` : ''}</td><td><b>${d}</b>/${keys.length} <span class="pc">${pct(d, keys.length)}%</span></td><td class="wide">${bar(d, keys.length)}</td></tr>`; };
  // year grid: each tracked season's pages (year, best team, its tracked games, your top 5 that year)
  const yItems = {}, add = (y, k) => (yItems[y] = yItems[y] || new Set()).add(k);
  for (const k of K.Y) add(+k.slice(2), k);
  for (const k of K.T) add(D.teams[k.slice(2)].y, k);
  for (const k of K.G) add(D.games[k.slice(2)].y, k);
  for (const [y, yd] of Object.entries(D.years)) if (yItems[y]) for (const e of yd.top || []) if (e[5] && e[0] !== 'WPA') add(+y, 'p_' + e[5]);
  const years = Object.keys(yItems).map(Number).sort((a, b) => a - b), yf = y => { const ks = [...yItems[y]]; return ks.filter(isDone).length / ks.length; };
  const step = f => f === 0 ? 0 : f < .34 ? 1 : f < .67 ? 2 : f < 1 ? 3 : 4, grid = [];
  for (let d = Math.floor(years[0] / 10) * 10; d <= years[years.length - 1]; d += 10) grid.push(`<div class="yg-row"><span class="yg-d">${d}s</span>${[...Array(10)].map((_, i) => { const y = d + i;
    return yItems[y] ? `<button class="yg s${step(yf(y))}" onclick="go('y_${y}')" title="${y}: ${[...yItems[y]].filter(isDone).length} of ${yItems[y].size} complete"><span>${String(y).slice(2)}</span></button>` : '<span class="yg none"></span>'; }).join('')}</div>`);
  const byPos = POSITIONS.map(pos => { const ks = K.P.filter(k => D.players[k.slice(2)].pos === pos); return [pos, ks]; }).filter(x => x[1].length);
  const next = (keys, rank) => keys.filter(k => !isDone(k)).sort((a, b) => rank(a) - rank(b)).slice(0, 5);
  const nP = next(K.P, k => D.players[k.slice(2)].ovr || 999), nT = next(K.T, k => D.teams[k.slice(2)].tr?.ar ?? 0), nG = next(K.G, k => D.games[k.slice(2)].rk);
  const nextRow = k => { const e = ent(k), o = e.o;
    const [a, b] = e.type === 'p' ? [rankLabel(o), nameOf(o)] : e.type === 't' ? [o.tr ? `#${o.tr.ar}` : String(o.y), `${o.y} ${o.n}`] : [`#${o.rk}`, `${o.y} ${o.gt || o.g}${o.d ? ' · ' + o.d : ''}`];
    return `<button class="row" onclick="go('${k}')"><span class="yr">${esc(a)}</span><span class="rn">${esc(b)}</span></button>`; };
  const all = [...K.all], allDone = done(all);
  return `${banner()}<div class="eyebrow">Your progress</div><h1 class="name">Tracker</h1>
   <p class="note">A page counts once you tick “Mark complete” on it. Everything starts incomplete.</p>
   <div class="overall"><div class="big"><b>${allDone}</b> of ${all.length} pages complete <span class="pc">${pct(allDone, all.length)}%</span></div>${bar(allDone, all.length)}</div>
   <h2>By page type</h2>
   <table class="track"><tr><th></th><th>Complete</th><th class="wide"></th></tr>${types.map(row).join('')}</table>
   <h2>Year by year <small>each season’s year page, best team, games and your top 5</small></h2>
   <div class="ygrid">${grid.join('')}</div>
   <div class="tlegend"><span><i class="yg s0"></i>none</span><span><i class="yg s1"></i>some</span><span><i class="yg s2"></i>a third</span><span><i class="yg s3"></i>two thirds</span><span><i class="yg s4"></i>all</span></div>
   <h2>Players by position</h2>
   <table class="track">${byPos.map(([pos, ks]) => row([pos, ks])).join('')}</table>
   <h2>Next up <small>the highest-ranked not yet complete</small></h2>
   ${nP.length ? `<h3 class="sm">Players, by your list</h3><div class="list">${nP.map(nextRow).join('')}</div>` : ''}
   ${nT.length ? `<h3 class="sm">Team seasons, best first by your model</h3><div class="list">${nT.map(nextRow).join('')}</div>` : ''}
   ${nG.length ? `<h3 class="sm">Games, by your list</h3><div class="list">${nG.map(nextRow).join('')}</div>` : ''}
   ${saveBox()}`;
}
const KINDS = [['story', 'Story'], ['quote', 'Quote'], ['scouting', 'Scouting'], ['personal', 'Personal'], ['video', 'Video'], ['link', 'Link']];
function clipsHTML(key) {
  const cl = prog(key)?.clips || [];
  return `${cl.length ? cl.map((c, i) => `<div class="clip"><div class="kind">${esc((KINDS.find(k => k[0] === c.k) || ['', 'Note'])[1])}</div>${esc(c.t || '')}${c.u ? `<div><a href="${esc(c.u)}" target="_blank" rel="noopener">${esc(c.u)}</a></div>` : ''}<button class="x" data-delclip="${i}" aria-label="Remove clipping">×</button></div>`).join('') : `<p class="empty">Nothing kept yet. Paste a quote, an anecdote, a good video link.</p>`}
  <form class="add" id="clipform">
    <textarea class="t" id="clip-t" placeholder="“Hot as hell, ain’t it, Prez?” or a one-line story"></textarea>
    <div class="r"><input class="t" id="clip-u" type="url" placeholder="Link (optional)"><select class="t" id="clip-k" style="flex:0 0 auto">${KINDS.map(k => `<option value="${k[0]}">${k[1]}</option>`).join('')}</select><button class="btn" type="submit">Keep</button></div>
  </form>`;
}
function avatar(k) { const p = D.players[k], ph = PHOTOS[k]; return `<span class="avatar">${ph ? `<img src="photos/${esc(ph.file)}" alt="" loading="lazy">` : esc(initials(p))}</span>`; }
function playerChip(k) { const p = D.players[k]; return p ? `<button class="chip ${litN('p_' + k) ? 'lit' : ''}" onclick="go('p_${k}')"><span class="k">${esc(p.pos)}</span>${esc(nameOf(p))}</button>` : ''; }
function teamBadge(t) {
  const logo = logoFor(t), [bg, fg] = teamColors(t);
  return logo ? `<span class="teambadge"><img src="logos/${esc(logo)}" alt=""></span>` : `<span class="teambadge" style="background:${bg};color:${fg}">${esc(t.br || t.tm)}</span>`;
}
const crumbs = (label, key) => `<div class="crumbs">${depth() ? `<button id="backbtn">← Back</button><span>·</span>` : ''}<span>${esc(label)}</span>${key ? `<span class="grow"></span>${doneHTML(key)}` : ''}</div>`;
const pagebar = key => { const d = doneHTML(key); return d ? `<div class="crumbs"><span class="grow"></span>${d}</div>` : ''; };
const banner = () => `<div class="banner" id="dbnote" ${note ? '' : 'hidden'}>${esc(note)}</div>`;
function gameRow(g) { return `<button class="row" onclick="go('g_${g.rk}')"><span class="yr">${g.y}</span><span class="rn">${esc(g.gt || g.g)}${g.d ? `<small>${esc(g.d)}</small>` : ''}<small>${g.o ? 'from your “Others” row' : `#${g.rk} on your list`}</small></span><span class="meta">${dotsHTML('g_' + g.rk)}</span></button>`; }
function placeText(f) { return f ? [f.c, f.r && f.r !== '—' && f.n !== 'Puerto Rico' ? f.r : null, f.n !== 'United States' ? f.n : null].filter(Boolean).join(', ') : ''; }
const placeLink = (f, lvl = 2) => f && f.n ? `<a href="#" onclick="go('l_${enc(placeKey(f, lvl))}');return false">${esc(placeText(f))}</a>` : '';

/* ================================================================ views */
/* ---------------- your notes (docs/data/notes.json, from scripts/build_notes.py) ---------------- */
const decadeOf = y => y < 1871 ? 'pre' : String(Math.floor(y / 10) * 10);
const decadeName = d => d === 'pre' ? 'Before 1871' : d + 's';
function md(s) {  // your doc's text: escape it, then turn [text](url) and bare links into links
  let h = esc(s).replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  return h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, u) => `${pre}<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}…</a>`);
}
function writeup(paras, open = 2) {  // first paragraphs shown, the rest behind "Keep reading"
  if (!paras || !paras.length) return '';
  const p = x => `<p>${md(x)}</p>`;
  return `<div class="writeup">${paras.slice(0, open).map(p).join('')}${paras.length > open ? `<details><summary>Keep reading <small>${paras.length - open} more paragraphs</small></summary>${paras.slice(open).map(p).join('')}</details>` : ''}</div>`;
}
const quickList = xs => xs && xs.length ? `<ul class="quick">${xs.map(x => `<li>${md(x)}</li>`).join('')}</ul>` : '';
/* the leagues your era notes name, one section each on the decade page */
const LEAGUES = { NA: 'National Association', NL: 'National League', AL: 'American League', AA: 'American Association', UA: 'Union Association', PL: "Players' League", FL: 'Federal League',
  IA: 'International Association', IBB: 'Independent Black baseball', Cuba: 'Cuban League', NNL: 'Negro National League', ECL: 'Eastern Colored League', ANL: 'American Negro League',
  EWL: 'East-West League', NSL: 'Negro Southern League', NAL: 'Negro American League', Venezuela: 'Venezuelan League', Japan: 'Japanese Baseball League', NPB: 'Nippon Professional Baseball',
  Dominican: 'Dominican League', LIDOM: 'Dominican Winter League (LIDOM)', Mexico: 'Mexican League', PR: 'Puerto Rican Winter League', 'Pre-major leagues': 'Before the major leagues' };
const LG_ALIAS = { 'E-WL': 'EWL' };
function leaguesOf(eras, y0, y1) {  // [{code, y0, y1, clubs}] in order of first appearance
  const out = new Map();
  for (const e of eras) for (let c of e[2].split(',').flatMap(x => x.split('/')).map(x => x.trim()).filter(Boolean)) {
    c = LG_ALIAS[c] || c; const a = Math.max(e[0], y0), b = Math.min(e[1], y1), cur = out.get(c);
    if (cur) { cur.y0 = Math.min(cur.y0, a); cur.y1 = Math.max(cur.y1, b); } else out.set(c, { code: c, y0: a, y1: b, clubs: [] });
    if (c === 'IBB' && e[3]) for (const x of e[3].split(',').map(x => x.trim())) if (x && !out.get(c).clubs.includes(x)) out.get(c).clubs.push(x);
  }
  return [...out.values()];
}
function leagueSection(key, l, y0, y1) {
  const codes = l.code === 'NNL' ? ['NNL', 'NN2'] : [l.code], champs = [];
  for (let y = l.y0; y <= l.y1; y++) {
    const tms = Object.entries(D.teams).filter(([, t]) => t.y === y && codes.includes(t.lg)); if (!tms.length) continue;
    const w = tms.find(([, t]) => t.pen) || tms.slice().sort((a, b) => (a[1].rk || 99) - (b[1].rk || 99))[0]; champs.push([y, ...w]);
  }
  const yrs = l.y0 === l.y1 ? l.y0 : `${l.y0}–${l.y1}`;
  return `<h2>${esc(LEAGUES[l.code] || l.code)} <small>${yrs}</small></h2>
   ${l.clubs.length ? `<p class="note" style="margin:0 0 6px">Black clubs and independents: ${esc(l.clubs.join(', '))}</p>` : ''}
   ${champs.length ? `<div class="list">${champs.map(([y, tid, t]) => `<button class="row" onclick="go('t_${tid}')">${badgeSm(t)}<span class="yr">${y}</span><span class="rn">${esc(t.n)}<small>${t.w ?? '?'}–${t.l ?? '?'}${t.ws ? ' · won the World Series' : t.pen ? ' · pennant' : ' · first place'}</small></span></button>`).join('')}</div>` : ''}
   ${noteSection(key, 'lg_' + l.code, '', 'What this league was like, its stars, its stories…', [], { sub: true, bare: true })}`;
}
function vDecade() {
  const d = view.id === 'pre' ? 'pre' : String(Math.floor(+view.id / 10) * 10), pre = d === 'pre';
  const y0 = pre ? 1845 : +d, y1 = pre ? 1870 : Math.min(+d + 9, 2026), dn = NOTES.decades[d] || {};
  const eras = D.eras.filter(e => e[0] <= y1 && e[1] >= y0);
  const prev = pre ? null : +d === 1870 ? 'pre' : String(+d - 10), next = pre ? '1870' : +d < 2020 ? String(+d + 10) : null;
  const years = []; for (let y = Math.max(y0, 1871); y <= y1 && !pre; y++) years.push(y);
  const MAJ = ['NL', 'AL', 'AA', 'UA', 'PL', 'FL', 'NA'];  // the World Series champion, not a Negro World Series winner
  const yearRow = y => { const tms = Object.entries(D.teams).filter(([, t]) => t.y === y), ws = tms.find(([, t]) => t.ws && MAJ.includes(t.lg)) || tms.find(([, t]) => t.ws), q = (NOTES.years[y] || {}).quick || [];
    return `<div class="yrow">${ws ? `<button class="ylogo" onclick="go('t_${ws[0]}')" title="${esc(ws[1].n)}">${badgeSm(ws[1])}</button>` : '<span class="ylogo"></span>'}<button class="yhead" onclick="go('y_${y}')"><b>${y}</b>${ws ? `<span>${esc(ws[1].n)} win the Series</span>` : `<span>${tms.length} teams</span>`}</button>${quickList(q.filter(x => !/^New leagues: *$/i.test(x)))}</div>`; };
  return `${pagebar('d_' + d)}${banner()}
  <div style="display:flex;align-items:center;gap:10px">${prev ? `<button class="iconbtn" onclick="go('d_${prev}')" aria-label="Previous decade">‹</button>` : ''}<h1 class="name" style="margin:0">${decadeName(d)}</h1>${next ? `<button class="iconbtn" onclick="go('d_${next}')" aria-label="Next decade">›</button>` : ''}</div>
  ${eras.length ? `<h2>Your era notes</h2><div class="list">${eras.map(e => `<div class="row" style="cursor:default"><span class="yr">${e[0]}${e[1] !== e[0] ? '–' + e[1] : ''}</span><span class="rn">${esc(e[2])}</span></div>`).join('')}</div>
  ${leaguesOf(eras, y0, y1).map(l => leagueSection('d_' + d, l, y0, y1)).join('')}` : ''}
  ${pre ? `<h2>Your history <small>the game before the leagues</small></h2>${writeup(NOTES.pre, 4)}` : ''}
  ${years.length ? `<h2>Year by year <small>rule changes and your notes</small></h2><div class="years">${years.map(yearRow).join('')}</div>` : ''}
  ${dn.text && dn.text.length ? `<h2>Your write-up</h2>${writeup(dn.text)}` : ''}`;
}
function vYear() {
  const y = +view.id; if (YEAR !== y) { YEAR = y; $('#yr').value = y; $('#bigyear').textContent = y; }
  const yd = D.years[y] || {}, era = D.eras.find(e => y >= e[0] && y <= e[1]);
  const tms = Object.entries(D.teams).filter(([, t]) => t.y === y);
  const lgs = [...new Set(tms.map(([, t]) => t.lg))];
  const ws = tms.filter(([, t]) => t.ws), pen = tms.filter(([, t]) => t.pen && !t.ws);
  const top = yd.top || [], topH = top.filter(e => e[0] === 'H'), topP = top.filter(e => e[0] === 'P'), rp = top.find(e => e[0] === 'RP'), wpa = top.find(e => e[0] === 'WPA');
  const entry = e => e[5] ? `<button class="row" onclick="go('p_${e[5]}')">${avatar(e[5])}<span class="yr">#${e[1]}${e[2] ? ' ' + e[2] : ''}</span><span class="rn">${esc(e[3])}</span><span class="meta">${esc(e[4])} ${dotsHTML('p_' + e[5])}</span></button>`
    : `<div class="row" style="cursor:default"><span class="avatar">·</span><span class="yr">#${e[1]}${e[2] ? ' ' + e[2] : ''}</span><span class="rn">${esc(e[3])}</span><span class="meta">${esc(e[4])}</span></div>`;
  const gms = (yd.games || []).map(r => D.games[r]).sort((a, b) => b.gr - a.gr || a.rk - b.rk);
  const yn = NOTES.years[y] || {};
  const champ = ([tid, t]) => `<button class="row" onclick="go('t_${tid}')">${badgeSm(t)}<span class="rn">${esc(t.n)}<small>${t.ws ? 'won the World Series' : esc(t.lg) + ' pennant'}${t.w != null ? ` · ${t.w}–${t.l}` : ''}</small></span><span class="meta">${dotsHTML('t_' + tid)}</span></button>`;
  return `${pagebar('y_' + y)}${banner()}<div class="eyebrow">${y} · <a href="#" onclick="go('d_${decadeOf(y)}');return false">the ${decadeName(decadeOf(y))}</a></div>
  <div class="sub" style="margin-top:4px"><span><b>${tms.length}</b> teams</span><span><b>${tms.filter(([tid]) => litN('t_' + tid)).length}</b> complete</span>${lgs.length ? `<span>${lgs.map(l => esc(l)).join(' · ')}</span>` : ''}</div>
  ${ws.length || pen.length ? `<h2>Champions</h2><div class="list">${[...ws, ...pen].map(champ).join('')}</div>` : ''}
  ${tms.some(([, t]) => t.tr) ? `<h2>Teams by your model <small>talent and results</small></h2><div class="list">${tms.filter(([, t]) => t.tr).sort((a, b) => a[1].tr.yr - b[1].tr.yr).slice(0, 8).map((e, i) => teamRankRow(e, i, false)).join('')}</div>` : ''}
  ${topH.length ? `<h2>Your top 5 <small>position players</small></h2><div class="list">${topH.map(entry).join('')}</div>` : ''}
  ${topP.length ? `<h2>Your top 5 <small>pitchers</small></h2><div class="list">${topP.map(entry).join('')}${rp ? entry(['', 1, 'RP', rp[3], rp[4], rp[5]]) : ''}</div>` : ''}
  ${yd.mH || yd.mP ? `<details class="allteams"><summary>Your model's top 10 that year</summary>
    ${yd.mH ? `<h3 class="sm">Position players</h3>${modelList(yd.mH, new Set(topH.map(e => e[3])))}` : ''}
    ${yd.mP ? `<h3 class="sm">Pitchers</h3>${modelList(yd.mP, new Set(topP.map(e => e[3])))}` : ''}
    ${yd.mRP ? `<h3 class="sm">Best reliever, by rate</h3>${modelList([yd.mRP], new Set(rp ? [rp[3]] : []))}` : ''}</details>` : ''}
  ${wpa ? `<p class="note">cWPA leader: ${wpa[5] ? `<a href="#" onclick="go('p_${wpa[5]}');return false">${esc(wpa[3])}</a>` : esc(wpa[3])}</p>` : ''}
  ${gms.length ? `<h2>Great games</h2><div class="list">${gms.map(gameRow).join('')}</div>` : ''}
  ${yn.quick && yn.quick.length ? `<h2>Changes and notes</h2>${quickList(yn.quick)}` : ''}
  ${yn.text && yn.text.length ? `<h2>Your write-up</h2>${writeup(yn.text)}` : ''}
  ${era ? `<h2>Your era notes <small>${era[0]}${era[1] !== era[0] ? '–' + era[1] : ''}</small></h2><p style="margin:0">${esc(era[2])}</p>${era[3] ? `<p class="note" style="margin-top:4px">Black clubs and independents: ${esc(era[3])}</p>` : ''}` : ''}
  ${tms.length ? `<details class="allteams"><summary>All ${tms.length} teams</summary><div class="chips">${tms.sort((a, b) => a[1].lg.localeCompare(b[1].lg) || a[1].rk - b[1].rk).map(([tid, t]) => `<button class="chip ${litN('t_' + tid) ? 'lit' : ''}" onclick="go('t_${tid}')"><span class="k">${esc(t.lg)}</span>${esc(t.n)}</button>`).join('')}</div></details>` : `<p class="empty">No league teams in the database this year. Your pins and era notes are the way in.</p>`}
  ${saveBox()}`;
}
function saveBox() {
  const n = Object.keys(STORE.progress).length, u = unbacked(), tok = ghToken();
  const status = tok ? (SYNC.state === 'error' ? `<b class="bad">Not saved: ${esc(SYNC.err)}.</b> It’ll keep trying; your changes are safe in this browser meanwhile.`
      : `Saving to GitHub (<code>progress.json</code> on the <code>${GH.branch}</code> branch) as you go. ${SYNC.at ? 'Last saved ' + ago(SYNC.at) + '.' : ''}`)
    : `Your check-offs, grades and notes (${n} page${n === 1 ? '' : 's'}) are saved only in this browser${u ? `, <b class="bad">${u} not backed up</b>` : ''}. Clearing site data would lose them.`;
  const connect = tok ? `<button class="btn ghost" id="ghsave">Save now</button><button class="btn ghost" id="ghoff">Disconnect GitHub</button>`
    : `<details class="ghconnect"><summary>Save to GitHub automatically</summary>
       <p>Make a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token ↗</a> with access to only <code>${GH.repo}</code> and <b>Contents: Read and write</b>, then paste it here. Do this once in each browser you use. The token stays in this browser; the repo is public, so your progress file is too.</p>
       <form id="ghform" class="r"><input class="t" id="ghtoken" type="password" placeholder="github_pat_…" autocomplete="off"><button class="btn" type="submit">Connect</button></form></details>`;
  return `<div class="savebox" id="savebox"><div>${status}</div>${connect ? `<div class="r">${connect}</div>` : ''}
  <div class="r"><button class="btn ghost" id="exportbtn">Export a copy</button><label class="btn ghost" style="cursor:pointer">Import…<input type="file" id="importfile" accept="application/json" hidden></label><span id="savemsg"></span></div></div>`;
}
function refreshSaveBox() { const b = $('#savebox'); if (b && !b.contains(document.activeElement)) { b.outerHTML = saveBox(); wireSave(); } }

function vPlayer() {
  const k = view.id, p = D.players[k]; if (!p) return notFound();
  const key = 'p_' + k, pitcher = POSP.has(p.pos), ph = PHOTOS[k], f = fromOf(k), n = nameOf(p);
  const rank = [p.ovr ? `#${p.ovr} overall` : typeof p.prk === 'string' ? `List group ${esc(p.prk)}` : '', typeof p.prk === 'number' ? `#${p.prk} ${esc(p.pos)}` : esc(p.pos),
    `peak ${p.pk ? `<a href="#" onclick="go('y_${p.pk}');return false">${p.pk}</a>` : '?'}`].filter(Boolean).join(' · ');
  const ht = p.ht ? `${Math.floor(p.ht / 12)}′${p.ht % 12}″${p.wt ? ', ' + p.wt + ' lb' : ''}` : '';
  const br = p.br ? `https://www.baseball-reference.com/players/${p.br[0]}/${p.br}.shtml` : `https://www.baseball-reference.com/search/search.fcgi?search=${enc(n)}`;
  return `${crumbs('Player', key)}${banner()}
   <div class="hero">${ph ? `<figure class="photo" style="margin:0"><img src="photos/${esc(ph.file)}" alt="${esc(n)}" title="Photo: ${esc(ph.credit || 'unknown')}${ph.license ? ' · ' + esc(ph.license) : ''}"></figure>` : ''}
   <div class="who"><div class="eyebrow">${rank}</div><h1 class="name">${esc(n)}</h1>
   ${f ? `<div class="sub"><span>From ${placeLink(f)}</span></div>` : ''}</div></div>
   ${careerHTML(p, k)}
   ${noteSection(key, 'career', 'Stories from the career', 'The 1934 strike, the trade, the slump he broke…', [['Baseball-Reference', br], ['Old newspapers', loc(n)]])}
   ${playerNotes(k, (p.ss || []).length > 0)}
   <h2>The person</h2>
   <dl class="facts">
     ${p.born ? `<dt>Born</dt><dd>${esc(p.born)}${p.bplace ? ' · ' + esc(p.bplace) : ''}</dd>` : ''}
     ${p.died ? `<dt>Died</dt><dd>${esc(p.died)}</dd>` : ''}
     ${ht ? `<dt>Size</dt><dd>${ht}</dd>` : ''}
     ${p.bt && p.bt !== '?/?' ? `<dt>Bats/Throws</dt><dd>${esc(p.bt)}</dd>` : ''}
   </dl>
   ${noteSection(key, 'person', 'Stories about the person', 'Where he grew up, what teammates said, a quote…', [['SABR biography', sabr(n)], ['Wikipedia', wiki(n + ' baseball')], ['A biography', books(n + ' biography')]], { sub: true })}
   ${noteSection(key, 'highlights', 'Highlights', 'Paste a video link', [['YouTube', yt(n + ((p.pk || 2000) < 1925 ? ' baseball footage' : ' highlights'))]], { link: true, pre: ytEmbed(p.md?.hl) })}
   ${noteSection(key, 'interview', 'Interview or voice', 'Paste a video or audio link', [['YouTube', yt(n + ' interview')]], { link: true, pre: ytEmbed(p.md?.iv) })}
   ${noteSection(key, 'photos', 'Photos', 'Paste an image link', [['Image search', img(n + ' baseball ' + (p.pk || ''))]], { link: true, img: true, pre: photoGrid(p.md?.ph) })}
   <h2>Scouting card <small>your grades, one click each${p.tools ? '; outlined ones are your model’s until you choose' : ''}</small></h2>${gradesHTML(key, pitcher, p.tools)}
   ${(prog(key)?.clips || []).length ? `<h2>Older clippings</h2>${clipsHTML(key)}` : ''}`;
}
// one table for the whole career: a row per season and team, your model's rating and rank that year, your top 5,
// career totals at the bottom
function careerHTML(p, k) {
  const pitcher = POSP.has(p.pos), rel = p.mr?.rel, ss = p.ss || [], bat = p.bat, pit = p.pit;
  const showBat = bat && (!pitcher || bat.AB > 1500), showPit = pit && (pitcher || parseFloat(pit.IP) > 300);
  const by = {}; for (const a of p.arc || []) if ((a[3] === 'R') === !!rel && (!by[a[0]] || a[1] > by[a[0]][1])) by[a[0]] = a;
  const t5 = {}; for (const r of p.ranks || []) if (r[1] !== 'WPA') t5[r[0]] = `#${r[2]}${r[1] === 'P' ? ' P' : r[1] === 'RP' ? ' RP' : ''}`;
  const by0 = p.born ? p.born.split('-').map(Number) : null, age = y => by0 ? y - by0[0] - ((by0[1] || 1) > 6 ? 1 : 0) : '';
  const m = p.mr, best = Object.values(by).reduce((b, a) => !b || a[1] > b[1] ? a : b, null);
  const head = m ? `<div class="sub" style="margin-top:0">${m.rel ? `<span><b>${fmtS(m.r)}</b> per-batter rating</span><span><b>#${m.rk}</b> among relievers</span>` : `<span><b>${fmtS(m.r)}</b> ${tierOf(m.r)}</span><span><b>#${m.rk}</b> overall</span><span><b>#${m.prk}</b> ${esc(m.pos)}</span>`}${m.war ? `<span><b>${m.war}</b> career WAR</span>` : ''}<span>${m.hof ? 'In the Hall' : m.rel ? '' : `<b>${Math.round(m.odds * 100)}%</b> Hall case`}</span>${best ? `<span>best: <a href="#" onclick="go('y_${best[0]}');return false">${best[0]}</a></span>` : ''}</div>` : '';
  const clubs = p.clubs && p.clubs.length ? `<h3 class="sm">Clubs</h3><div class="list">${p.clubs.map(c => c[4] ? `<button class="row" onclick="go('c_${c[4]}')"><span class="yr">${esc(c[1])}</span><span class="rn">${esc(c[0])}</span></button>` : `<div class="row" style="cursor:default"><span class="yr">${esc(c[1])}</span><span class="rn">${esc(c[0])}</span></div>`).join('')}</div>` : '';
  if (!ss.length || !(showBat || showPit)) return `<h2>Career</h2>${head}${clubs}`;
  const primP = !showBat || (pitcher && showPit);
  const B = [['G', 0], ['PA', 1], ['R', 3], ['H', 4], ['2B', 5], ['3B', 6], ['HR', 7], ['RBI', 8], ['SB', 9], ['BB', 10], ['SO', 11], ['AVG', 12], ['OBP', 13], ['SLG', 14]];
  const Pc = [['W', 0], ['L', 1], ['ERA', 10], ['G', 2], ['GS', 3], ['SV', 4], ['IP', 5], ['H', 6], ['BB', 7], ['SO', 8], ['HR', 9]];
  const main = primP ? Pc : B, mi = primP ? 4 : 3, second = primP ? (showBat ? [['AVG', 12], ['OBP', 13], ['SLG', 14]] : []) : (showPit ? [['W–L', -1], ['IP', 5], ['ERA', 10]] : []), si = primP ? 3 : 4;
  const cell = (line, c) => !line ? '' : c[1] === -1 ? `${line[0]}–${line[1]}` : esc(line[c[1]]);
  const reads = seasonReads(k), ncol = 6 + main.length + second.length, yrs = [...new Set([...ss.map(r => r[0]), ...Object.keys(reads).map(Number)])].sort((a, b) => a - b);
  const readRow = y => reads[y] && reads[y][0] ? `<tr class="read"><td></td><td colspan="${ncol - 1}">${md(reads[y][0])}</td></tr>` : '';
  const rows = yrs.map(y => { const rs = ss.filter(r => r[0] === y), a = by[y];
    if (!rs.length) return `<tr class="nostat"><td><a href="#" onclick="go('y_${y}');return false">${y}</a></td><td>${age(y)}</td><td colspan="${ncol - 2}">${esc(reads[y][1])}</td></tr>${readRow(y)}`;
    return rs.map((r, i) => `<tr><td>${i ? '' : `<a href="#" onclick="go('y_${y}');return false">${y}</a>`}</td><td>${i ? '' : age(y)}</td><td>${r[1] ? `<a href="#" onclick="go('t_${r[1]}');return false">${esc(r[2])}</a>` : r[5] ? `<a href="#" onclick="go('c_${r[5]}');return false">${esc(r[2])}</a>` : esc(r[2])}</td><td class="mdl">${!i && a ? fmtS(a[1]) : ''}</td><td class="mdl">${!i && a ? '#' + a[2] : ''}</td><td class="t5">${!i && t5[y] ? t5[y] : ''}</td>${main.map(c => `<td>${cell(r[mi], c)}</td>`).join('')}${second.map(c => `<td class="sec">${cell(r[si], c)}</td>`).join('')}</tr>`).join('') + readRow(y); }).join('');
  const sum = (idx, i) => ss.reduce((t, r) => t + (r[idx] ? +r[idx][i] || 0 : 0), 0);
  const tot = c => primP ? ({ ERA: pit.ERA, IP: pit.IP }[c[0]] ?? sum(4, c[1])) : ({ AVG: bat.AVG, OBP: bat.OBP, SLG: bat.SLG }[c[0]] ?? sum(3, c[1]));
  const tot2 = c => c[1] === -1 ? `${pit.W}–${pit.L}` : primP ? bat[c[0]] : pit[c[0]];
  return `<h2>Career <small>${rel ? 'Rating is per batter faced' : 'Rating is your model’s for the season, Rk where it ranked that year'}; your read from the doc under each season</small></h2>${head}
   <div class="statline"><table class="stats career"><tr><th>Year</th><th>Age</th><th>Team</th><th class="mdl">Rating</th><th class="mdl">Rk</th><th class="t5" title="Your top 5 that year">Top 5</th>${main.map(c => `<th>${c[0]}</th>`).join('')}${second.map(c => `<th class="sec">${c[0]}</th>`).join('')}</tr>
   ${rows}<tr class="tot"><td>Career</td><td></td><td></td><td class="mdl">${m ? fmtS(m.r) : ''}</td><td class="mdl">${m ? '#' + m.rk : ''}</td><td></td>${main.map(c => `<td>${tot(c)}</td>`).join('')}${second.map(c => `<td class="sec">${tot2(c)}</td>`).join('')}</tr></table></div>`;
}
const ytEmbed = v => v ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(v[0])}" title="${esc(v[1])}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
  <p class="note">${esc(v[1])} · ${esc(v[2])}: the top YouTube result; add a better one below if it isn’t right.</p>` : '';
const photoGrid = ph => ph && ph.length ? `<div class="pgrid">${ph.map(x => `<a href="${esc(x[3])}" target="_blank" rel="noopener" title="${esc(x[4] ? x[4] + ' · ' : '')}Photo: ${esc(x[1])}${x[2] ? ' · ' + esc(x[2]) : ''}"><img src="${esc(x[0])}" alt="${esc(x[4] || '')}" loading="lazy"></a>`).join('')}</div>` : '';
// a section you fill in, like clippings: a line of text and/or a link per entry
function noteSection(key, sec, title, ph, links = [], o = {}) {
  const list = prog(key)?.notes?.[sec] || [], isImg = u => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u) || /upload\.wikimedia\.org/.test(u);
  const head = o.bare ? '' : `${o.sub ? '<h3 class="sm">' : '<h2>'}${title}${links.length ? ` <small class="find">${links.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)} ↗</a>`).join(' · ')}</small>` : ''}${o.sub ? '</h3>' : '</h2>'}`;
  return `${head}${o.pre || ''}${list.map((c, i) => `<div class="clip">${o.img && c.u && isImg(c.u) ? `<img class="clipimg" src="${esc(c.u)}" alt="" loading="lazy">` : ''}${c.t ? `<div>${esc(c.t)}</div>` : ''}${c.u ? `<div><a href="${esc(c.u)}" target="_blank" rel="noopener">${esc(c.u)}</a></div>` : ''}<button class="x" data-delnote="${sec}:${i}" aria-label="Remove">×</button></div>`).join('')}
   <form class="add noteform" data-sec="${sec}">${o.link ? `<div class="r"><input class="t nu" type="url" placeholder="${esc(ph)}"><input class="t nt" placeholder="Note (optional)"><button class="btn" type="submit">Add</button></div>`
     : `<textarea class="t nt" placeholder="${esc(ph)}"></textarea><div class="r"><input class="t nu" type="url" placeholder="Link (optional)"><button class="btn" type="submit">Add</button></div>`}</form>`;
}
// your doc's lines about a player that start with "YYYY (...)": year -> [what you wrote, the team/position bit]
function seasonReads(k) {
  const out = {}; for (const x of NOTES.players[k] || []) { const m = x.match(/^(\d{4}) \(([^)]*)\):?\s*(.*)$/); if (m) out[m[1]] = [m[3] || '', m[2]]; }
  return out;
}
function playerNotes(k, seasonsInTable) {
  const ps = NOTES.players[k]; if (!ps || !ps.length) return '';
  const season = /^\d{4} \(/, seasons = seasonsInTable ? [] : ps.filter(x => season.test(x)), text = ps.filter(x => !season.test(x));
  return `${text.length ? `<h2>Your write-up</h2>${writeup(text, 3)}` : ''}
   ${seasons.length ? `<h2>Season by season <small>your read</small></h2><div class="list">${seasons.map(x => { const m = x.match(/^(\d{4}) \(([^)]*)\):?\s*(.*)$/) || [, x.slice(0, 4), '', x];
     return `<div class="row" style="cursor:default"><span class="yr">${m[1]}</span><span class="rn">${md(m[3] || '')}<small>${esc(m[2])}</small></span></div>`; }).join('')}</div>` : ''}`;
}
function vTeam() {
  const tid = view.id, t = D.teams[tid]; if (!t) return notFound();
  const key = 't_' + tid, fr = D.franch[t.fr], seasons = fr ? fr.s : [tid];
  const i = seasons.indexOf(tid), prev = seasons[i - 1], next = seasons[i + 1];
  const park = t.pk && D.parks[t.pk], ro = t.ro || [], gms = Object.values(D.games).filter(g => g.tid === tid);
  const eras = []; for (const s of seasons) { const x = D.teams[s], city = x.pl?.c || ''; const last = eras[eras.length - 1]; if (last && last.n === x.n && last.c === city) last.y1 = x.y; else eras.push({ n: x.n, c: city, y0: x.y, y1: x.y, tid: s }); }
  return `${crumbs('Team season', key)}${banner()}
   <div class="hero">${teamBadge(t)}<div class="who"><div class="eyebrow">${esc(LG[t.lg] || t.lg)}${t.dv ? ' · ' + esc(t.dv) + ' division' : ''}</div>
   <div style="display:flex;align-items:center;gap:8px">${prev ? `<button class="iconbtn" onclick="go('t_${prev}')" aria-label="Previous season">‹</button>` : ''}<h1 class="name" style="margin:0">${t.y} ${esc(t.n)}</h1>${next ? `<button class="iconbtn" onclick="go('t_${next}')" aria-label="Next season">›</button>` : ''}</div></div></div>
   <div class="sub" style="margin-top:8px"><span><b>${t.w ?? '?'}–${t.l ?? '?'}</b></span>${t.rk ? `<span>finished <b>${ordinal(t.rk)}</b></span>` : ''}${t.ws ? '<span class="badge gold">World Series champions</span>' : t.pen ? '<span class="badge gold">Pennant</span>' : ''}${t.pl ? `<span>${placeLink(t.pl)}</span>` : ''}<span><a href="#" onclick="go('y_${t.y}');return false">The ${t.y} season</a></span></div>
   ${t.tr ? `<h2>By your model <small>talent and results</small></h2><div class="sub" style="margin-top:0"><span><b>${fmtS(t.tr.a)}</b> wins over an average team</span><span><b>#${t.tr.yr}</b> of ${t.tr.n} in ${t.y}</span><span><b>#${t.tr.ar}</b> all-time</span></div>
   <p class="note">Per 162 games: talent ${fmtS(t.tr.tal)} (80%), Pythagorean record ${fmtS(t.tr.py)} (15%), actual record ${fmtS(t.tr.wp)} (5%)${t.w + t.l < 150 ? ', records shrunk toward .500 for the short season' : ''}.</p>
   <p class="note">${t.tr.v} projected WAR per 162: ${t.tr.h} from position players, ${t.tr.p} from pitchers. Most of it from ${t.tr.top.map(e => e[1] ? `<a href="#" onclick="go('p_${e[1]}');return false">${esc(e[0])}</a> (${e[2]})` : `${esc(e[0])} (${e[2]})`).join(', ')}.</p>` : ''}
   ${park || t.park ? `<h2>Ballpark</h2><div class="parkbox"><b>${esc(park ? park.n : t.park)}</b>${park ? ` · ${esc(park.c)} · used ${park.y0}–${park.y1}${park.al ? `<div class="note">Also called ${esc(park.al)}</div>` : ''}${park.note ? `<div class="note">Your note: ${esc(park.note)}</div>` : ''}` : (t.ap ? ' <span class="note">(map pin at the city)</span>' : '')}</div>` : ''}
   ${lightsHTML(key)}
   <h2>Doors</h2>${doorsHTML(key)}
   <h2>From your list <small>${ro.length} on this roster${t.ros ? ', most model WAR first' : ''}</small></h2>${ro.length ? `<div class="chips">${ro.map(k => t.ros && k in t.ros ? playerChip(k).replace('</button>', ` <span class="k">${t.ros[k].toFixed(1)} WAR</span></button>`) : playerChip(k)).join('')}</div>` : '<p class="empty">Nobody from your list played here this year.</p>'}
   ${rosterHTML(tid)}
   ${gms.length ? `<h2>Great games</h2><div class="list">${gms.map(gameRow).join('')}</div>` : ''}
   <h2>The franchise <small>${fr ? `<a href="#" onclick="go('f_${t.fr}');return false">${esc(fr.n)} ›</a>` : esc(t.n)}</small></h2>
   <div class="list">${eras.map(e => `<button class="row" onclick="go('t_${e.tid}')"><span class="yr">${e.y0}${e.y1 !== e.y0 ? '–' + e.y1 : ''}</span><span class="rn">${esc(e.n)}${e.c ? `<small>${esc(e.c)}</small>` : ''}</span></button>`).join('')}</div>
   <h2>Clippings</h2>${clipsHTML(key)}`;
}
function vFranchise() {
  const fid = view.id, fr = D.franch[fid]; if (!fr) return notFound();
  const key = 'f_' + fid, ts = fr.s.map(tid => [tid, D.teams[tid]]), first = ts[0][1], last = ts[ts.length - 1][1];
  const eras = []; for (const [tid, x] of ts) { const city = x.pl?.c || ''; const e = eras[eras.length - 1]; if (e && e.n === x.n && e.c === city) e.y1 = x.y; else eras.push({ n: x.n, c: city, y0: x.y, y1: x.y, tid }); }
  const W = ts.reduce((a, [, x]) => a + (x.w || 0), 0), Lo = ts.reduce((a, [, x]) => a + (x.l || 0), 0), pens = ts.filter(([, x]) => x.pen).length, wss = ts.filter(([, x]) => x.ws).length;
  const rated = ts.filter(([, x]) => x.tr).sort((a, b) => a[1].tr.ar - b[1].tr.ar);
  const mine = Object.entries(D.players).filter(([, p]) => (p.st || []).some(st => st[0] === fid)).sort((a, b) => (a[1].ovr || 999) - (b[1].ovr || 999)).map(([k]) => k);
  const season = ([tid, x]) => `<tr><td><a href="#" onclick="go('t_${tid}');return false">${x.y}</a></td><td class="nm">${esc(x.n)}</td><td>${x.w ?? ''}–${x.l ?? ''}</td><td>${x.rk ? ordinal(x.rk) : ''}</td><td>${x.ws ? 'WS' : x.pen ? 'Pennant' : ''}</td><td>${x.tr ? fmtS(x.tr.a) : ''}</td><td>${x.tr ? '#' + x.tr.ar : ''}</td><td>${x.top ? '★' : ''}</td></tr>`;
  return `${crumbs('Franchise', key)}${banner()}
   <div class="hero">${teamBadge(last)}<div class="who"><div class="eyebrow">Franchise · ${first.y}${last.y !== first.y ? '–' + last.y : ''}</div><h1 class="name">${esc(fr.n)}</h1></div></div>
   <div class="sub" style="margin-top:8px"><span><b>${ts.length}</b> season${ts.length > 1 ? 's' : ''}</span>${W + Lo ? `<span><b>${W}–${Lo}</b> all-time</span>` : ''}${pens ? `<span><b>${pens}</b> pennant${pens > 1 ? 's' : ''}</span>` : ''}${wss ? `<span><b>${wss}</b> World Series</span>` : ''}</div>
   ${lightsHTML(key)}
   <h2>Doors</h2>${doorsHTML(key)}
   <h2>Names and homes</h2><div class="list">${eras.map(e => `<button class="row" onclick="go('t_${e.tid}')"><span class="yr">${e.y0}${e.y1 !== e.y0 ? '–' + e.y1 : ''}</span><span class="rn">${esc(e.n)}${e.c ? `<small>${esc(e.c)}</small>` : ''}</span></button>`).join('')}</div>
   ${rated.length ? `<h2>Best seasons <small>by your model</small></h2><div class="list">${rated.slice(0, 8).map(teamRankRow).join('')}</div>` : ''}
   ${mine.length ? `<h2>From your list <small>${mine.length} played here</small></h2><div class="chips">${mine.map(playerChip).join('')}</div>` : ''}
   <h2>Every season</h2><div class="statline"><table class="stats roster fr"><tr><th>Year</th><th class="nm">Team</th><th>W–L</th><th>Finish</th><th></th><th title="Your model, wins over an average team">Score</th><th>Rank</th><th title="Best team that season (tracked)">★</th></tr>${ts.map(season).join('')}</table></div>
   <h2>Clippings</h2>${clipsHTML(key)}`;
}
function vClub() {  // clubs outside the database (NPB, Cuba, Mexico, Puerto Rico...): who of yours played there
  const k = view.id, c = D.clubs[k]; if (!c) return notFound(); const key = 'c_' + k;
  const pl = c.pl.filter(x => D.players[x[0]]).sort((a, b) => (a[1] || 9999) - (b[1] || 9999));
  return `${crumbs('Club', key)}${banner()}<div class="eyebrow">${esc([c.c, c.cn].filter(Boolean).join(', '))}</div><h1 class="name">${esc(c.n)}</h1>
   <h2>From your list <small>${pl.length} played here</small></h2><div class="list">${pl.map(([pk, y0, y1]) => { const p = D.players[pk];
     return `<button class="row" onclick="go('p_${pk}')">${avatar(pk)}<span class="yr">${y0 ? y0 + (y1 !== y0 ? '–' + y1 : '') : ''}</span><span class="rn">${esc(nameOf(p))}<small>${esc(p.pos)}</small></span></button>`; }).join('')}</div>
   ${noteSection(key, 'club', 'The club', 'Its history, its park, its great teams…', [['Wikipedia', wiki(c.n + ' baseball')], ['Photos', img(c.n + ' baseball')]])}`;
}
function vGame() {
  const g = D.games[view.id]; if (!g) return notFound(); const key = 'g_' + g.rk, n = `${g.y} ${g.gt || g.g}`;
  if (!BOXES) boxLoad = boxLoad || getJSON('data/games.json', {}).then(b => { BOXES = b; if (view.type === 'g') render(false); });
  const bx = BOXES && BOXES[view.id], team = s => s.tid ? `<a href="#" onclick="go('t_${s.tid}');return false">${esc(s.n)}</a>` : esc(s.n);
  const line = bx ? (() => { const k = Math.max(9, bx.v.inn.length, bx.h.inn.length), cells = a => [...Array(k)].map((_, i) => `<td>${esc(a[i] ?? '')}</td>`).join('');
    return `<div class="statline"><table class="stats linescore"><tr><th></th>${[...Array(k)].map((_, i) => `<th>${i + 1}</th>`).join('')}<th class="rhe">R</th><th>H</th><th>E</th></tr>
      ${[bx.v, bx.h].map(s => `<tr><td class="nm">${team(s)}</td>${cells(s.inn)}<td class="rhe"><b>${s.r}</b></td><td>${s.h}</td><td>${s.e}</td></tr>`).join('')}</table></div>
      <div class="sub" style="margin-top:6px">${[bx.wp && `<span>W: <b>${esc(bx.wp)}</b></span>`, bx.lp && `<span>L: <b>${esc(bx.lp)}</b></span>`, bx.sv && `<span>S: <b>${esc(bx.sv)}</b></span>`].filter(Boolean).join('')}</div>
      <p class="note">${esc(bx.date)} · ${esc(bx.park)}${bx.att ? ` · ${bx.att.toLocaleString()} fans` : ''}${bx.time ? ` · ${Math.floor(bx.time / 60)}:${String(bx.time % 60).padStart(2, '0')}` : ''}</p>`; })() : '';
  const lineups = bx && (bx.v.lu.length || bx.h.lu.length) ? `<div class="lineups">${[bx.v, bx.h].map(s => `<div><h3 class="sm">${esc(s.n)}</h3><table class="stats roster">${s.lu.map((p, i) => `<tr><td>${i + 1}</td><td class="nm">${esc(p[0])}</td><td>${esc(p[1])}</td></tr>`).join('')}</table></div>`).join('')}</div>` : '';
  const vid = ytEmbed(g.yt);
  return `${crumbs('Game', key)}${banner()}<div class="eyebrow">${g.o ? 'From the “Others” row' : `#${g.rk}`}</div>
   <h1 class="name">${esc(n)}</h1>${g.vs ? `<p style="font-size:17px;margin:2px 0 0"><b>${esc(g.vs)}</b></p>` : ''}${g.d ? `<p style="font-size:17px;margin:2px 0 0">${esc(g.d)}</p>` : ''}
   <div class="sub" style="margin-top:8px">${g.tid ? `<span><a href="#" onclick="go('t_${g.tid}');return false">${esc(D.teams[g.tid].y + ' ' + D.teams[g.tid].n)}</a></span>` : ''}<span><a href="#" onclick="go('y_${g.y}');return false">More from ${g.y}</a></span></div>
   <h2>Line score</h2>${line || (BOXES ? '<p class="empty">No line score for this one in Retrosheet’s game logs.</p>' : '<p class="note">Loading…</p>')}
   ${bx ? `<h2>Box score <small><a href="${esc(bx.br)}" target="_blank" rel="noopener">full box score on Baseball-Reference ↗</a></small></h2>${lineups}` : ''}
   ${bx ? '<p class="note credit">Line scores and lineups: the information used here was obtained free of charge from and is copyrighted by Retrosheet (retrosheet.org).</p>' : ''}
   <h2>Video <small class="find"><a href="${esc(yt(n + ' ' + (g.d || '')))}" target="_blank" rel="noopener">YouTube search ↗</a></small></h2>${vid}
   ${noteSection(key, 'video', 'More video', 'Paste a video link', [], { sub: true, link: true })}
   ${noteSection(key, 'story', 'Game story', 'What happened, who was there, how it was written up…', [['SABR Games Project', sabr(n)], ['Next-day papers', loc(g.y + ' ' + (g.d || g.g))]])}
   ${(prog(key)?.clips || []).length ? `<h2>Older clippings</h2>${clipsHTML(key)}` : ''}`;
}
let PLACE_OPTS = null;

/* ---------------- homes: players, games, teams ---------------- */
const RK = { players: { f: '', sort: 'rank', pos: 'All' }, games: { f: '', sort: 'rank' }, teams: { f: '', grp: 'all', mode: 'rank', n: 100 } };
const LGROUP = { AL: 'mlb', NL: 'mlb', NA: 'early', AA: 'early', UA: 'early', PL: 'early', FL: 'early',
  NNL: 'negro', NN2: 'negro', ECL: 'negro', ANL: 'negro', EWL: 'negro', NSL: 'negro', NAL: 'negro' };
const GROUPS = [['mlb', 'American & National League'], ['early', '19th-century majors & Federal League'], ['negro', 'Negro Leagues'], ['ind', 'Independent clubs']];
function vList() {
  if (view.id === 'tracker') return vTracker();
  const h = view.id === 'teams' || view.id === 'games' ? view.id : 'players', st = RK[h], f = st.f.toLowerCase();
  const filter = (ph, extra = '') => `<div class="r" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"><input class="t" id="rkfilter" placeholder="${ph}" value="${esc(st.f)}">${extra}</div>`;
  const sortSel = yearLabel => `<select class="t" id="rksort" style="flex:0 0 auto"><option value="rank" ${st.sort === 'rank' ? 'selected' : ''}>Your order</option><option value="peak" ${st.sort === 'peak' ? 'selected' : ''}>${yearLabel}</option><option value="lit" ${st.sort === 'lit' ? 'selected' : ''}>Darkest first</option></select>`;
  if (h === 'players') {
    const arr = Object.entries(D.players).filter(([, p]) => (st.pos === 'All' || p.pos === st.pos) && (!f || nameOf(p).toLowerCase().includes(f)));
    const byRank = (a, b) => st.pos === 'All' ? (a[1].ovr || 999) - (b[1].ovr || 999) : (typeof a[1].prk === 'number' ? a[1].prk : 999) - (typeof b[1].prk === 'number' ? b[1].prk : 999);
    arr.sort({ rank: byRank, peak: (a, b) => (a[1].pk || 0) - (b[1].pk || 0), lit: (a, b) => litN('p_' + a[0]) - litN('p_' + b[0]) || byRank(a, b) }[st.sort] || byRank);
    const rows = arr.map(([k, p]) => { const fr = fromOf(k); const rk = st.pos === 'All' ? rankLabel(p) : (typeof p.prk === 'number' ? '#' + p.prk : p.prk || '') + ' ' + p.pos;
      return `<button class="row" onclick="go('p_${k}')">${avatar(k)}<span class="yr">${esc(rk)}</span><span class="rn">${esc(nameOf(p))}<small>peak ${p.pk || '?'}${fr ? ' · ' + esc(placeText(fr)) : ''}</small></span><span class="meta">${dotsHTML('p_' + k)}</span></button>`; }).join('');
    return `${banner()}<div class="eyebrow">Your list · ${Object.keys(D.players).length} players</div><h1 class="name">Players</h1>
     <div class="chips" style="margin-bottom:8px">${['All', ...POSITIONS].map(p => `<button class="chip" aria-pressed="${st.pos === p}" data-pos="${p}">${p}</button>`).join('')}</div>
     ${filter('Filter by name…', sortSel('Peak year'))}<div class="list">${rows || '<p class="empty">No one matches.</p>'}</div>`;
  }
  if (h === 'games') {
    const arr = Object.values(D.games).filter(g => !f || (g.y + ' ' + g.g + ' ' + (g.gt || '') + ' ' + g.d).toLowerCase().includes(f));
    arr.sort((a, b) => st.sort === 'lit' ? litN('g_' + a.rk) - litN('g_' + b.rk) || a.rk - b.rk : st.sort === 'peak' ? a.y - b.y : a.rk - b.rk);
    return `${banner()}<div class="eyebrow">Your list · ${Object.keys(D.games).length} games</div><h1 class="name">Games</h1>
     ${filter('Filter by year, series, description…', sortSel('Year'))}<div class="list">${arr.map(gameRow).join('') || '<p class="empty">No games match.</p>'}</div>`;
  }
  // teams: team seasons ranked by your model, or franchises with their name eras
  const rated = Object.entries(D.teams).filter(([, t]) => t.tr), ranked = rated.length && st.mode === 'rank';
  const modes = rated.length ? `<div class="chips" style="margin:8px 0">${[['rank', 'Ranked seasons'], ['franch', 'Franchises']].map(([m, l]) => `<button class="chip" aria-pressed="${st.mode === m}" data-tmode="${m}">${l}</button>`).join('')}</div>` : '';
  const grpChips = `<div class="chips" style="margin:8px 0">${[['all', 'All'], ...GROUPS].map(([g, l]) => `<button class="chip" aria-pressed="${st.grp === g}" data-grp="${g}">${g === 'all' ? 'All' : l}</button>`).join('')}</div>`;
  if (ranked) {
    const arr = rated.filter(([, t]) => (st.grp === 'all' || (LGROUP[t.lg] || 'ind') === st.grp) && (!f || (t.y + ' ' + t.n).toLowerCase().includes(f))).sort((a, b) => a[1].tr.ar - b[1].tr.ar);
    return `${banner()}<div class="eyebrow">Your model · ${rated.length} team seasons</div><h1 class="name">Teams</h1>
     <p class="note">Each player’s projected WAR per game for that season, weighted by his games for the team, summed and put on a 162-game scale. That talent, measured against a typical team of its era (a smooth curve over time), makes up 80% of the score; Pythagorean record is 15% and actual record 5% (shrunk toward .500 in short seasons). All three are in wins over an average team per 162, scaled to how spread out teams were in that era.</p>
     ${modes}${grpChips}${filter('Filter by year or team name…')}
     <div class="list">${arr.slice(0, st.n).map(teamRankRow).join('') || '<p class="empty">No teams match.</p>'}</div>
     ${arr.length > st.n ? `<button class="btn ghost" id="tmore" style="margin-top:10px">Show more (${arr.length - st.n} left)</button>` : ''}`;
  }
  const frs = Object.entries(D.franch).map(([fid, fr]) => {
    const ts = fr.s.map(x => D.teams[x]), last = ts[ts.length - 1], eras = [];
    for (const [i, t] of ts.entries()) { const e = eras[eras.length - 1]; if (e && e.n === t.n) e.y1 = t.y; else eras.push({ n: t.n, y0: t.y, y1: t.y, tid: fr.s[i] }); }
    return { fid, fr, ts, last, eras, grp: LGROUP[last.lg] || 'ind' };
  }).filter(x => (st.grp === 'all' || x.grp === st.grp) && (!f || x.eras.some(e => e.n.toLowerCase().includes(f))));
  const block = ([g, label]) => {
    const xs = frs.filter(x => x.grp === g).sort((a, b) => b.ts.length - a.ts.length); if (!xs.length) return '';
    return `<h2>${label} <small>${xs.length}</small></h2><div class="list">${xs.map(x => `<div class="row frow">${badgeSm(x.last)}<span class="yr">${x.ts[0].y}–${x.last.y}</span><span class="rn"><a href="#" onclick="go('f_${x.fid}');return false">${esc(x.last.n)}</a><small>${x.eras.length > 1 ? x.eras.map(e => `<a href="#" onclick="go('t_${e.tid}');return false">${esc(e.n)}</a> ${e.y0}${e.y1 !== e.y0 ? '–' + e.y1 : ''}`).join(' · ') : `${x.ts.length} season${x.ts.length > 1 ? 's' : ''}`}</small></span><span class="meta" title="seasons complete">${x.fr.s.filter(tid => litN('t_' + tid)).length}/${x.ts.length}</span></div>`).join('')}</div>`;
  };
  return `${banner()}<div class="eyebrow">${Object.keys(D.franch).length} franchises</div><h1 class="name">Teams</h1>
   <p class="note">Every franchise and the names it played under.</p>
   ${modes}${grpChips}
   ${filter('Filter by team name…')}${GROUPS.map(block).join('') || '<p class="empty">No teams match.</p>'}`;
}
function badgeSm(t) {
  const logo = logoFor(t), [bg, fg] = teamColors(t);
  return logo ? `<span class="avatar tb"><img src="logos/${esc(logo)}" alt=""></span>` : `<span class="avatar tb" style="background:${bg};color:${fg}">${esc(t.br || t.tm)}</span>`;
}

/* ---------------- places ---------------- */
let placeSel = null;
function vPlace() {
  const k = view.id === 'world' ? null : decodeURIComponent(view.id); placeSel = k;
  if (!k) {
    const countries = Object.values(PL).filter(n => n.lvl === 0).sort((a, b) => b.from.length - a.from.length || b.teams.length - a.teams.length);
    const states = Object.values(PL).filter(n => n.lvl === 1 && n.n === 'United States').sort((a, b) => b.from.length - a.from.length).slice(0, 12);
    const row = n => `<button class="row" onclick="go('l_${enc(n.k)}')"><span class="rn">${esc(placeLabel(n))}</span><span class="meta">${n.from.length} from · ${n.teams.length} team seasons</span></button>`;
    return `${banner()}<div class="eyebrow">Where baseball happened</div><h1 class="name">Places</h1><p class="note">Pick a country, state or city to see the best players from there, the best who played there, and the best teams it’s had. Players are placed where you say they’re from (birthplace unless you change it).</p>
     <h2>Countries</h2><div class="list">${countries.map(row).join('')}</div><h2>Top states</h2><div class="list">${states.map(row).join('')}</div>`;
  }
  const nd = PL[k]; if (!nd) return notFound();
  const parts = k.split('|'); const trail = [`<button onclick="go('l_world')">World</button>`];
  for (let i = 0; i < parts.length - 1; i++) { const pk = parts.slice(0, i + 1).join('|'); trail.push(`<span>›</span><button onclick="go('l_${enc(pk)}')">${esc(PL[pk] ? placeLabel(PL[pk]) : parts[i])}</button>`); }
  const subs = Object.values(PL).filter(n => n.lvl === nd.lvl + 1 && n.k.startsWith(k + '|')).sort((a, b) => b.from.length - a.from.length || b.teams.length - a.teams.length);
  const from = [...nd.from].sort((a, b) => (D.players[a].ovr || 999) - (D.players[b].ovr || 999));
  const played = [...nd.played.entries()].sort((a, b) => (D.players[a[0]].ovr || 999) - (D.players[b[0]].ovr || 999));
  const teams = nd.teams.map(t => [t, D.teams[t]]).filter(([, t]) => (t.w + t.l) >= 40 || t.pen).sort((a, b) => wpct(b[1]) - wpct(a[1]));
  const nWS = nd.teams.filter(t => D.teams[t].ws).length, nPen = nd.teams.filter(t => D.teams[t].pen).length;
  const prow = (pk, extra) => { const p = D.players[pk]; return `<button class="row" onclick="go('p_${pk}')">${avatar(pk)}<span class="yr">${esc(rankLabel(p))}</span><span class="rn">${esc(nameOf(p))}<small>${extra}</small></span><span class="meta">${dotsHTML('p_' + pk)}</span></button>`; };
  const LIM = 25;
  return `${pagebar('l_' + k)}${banner()}<div class="placecrumbs">${trail.join('')}</div><div class="eyebrow">${['Country', 'State / region', 'City'][nd.lvl]}</div><h1 class="name">${esc(placeLabel(nd))}</h1>
   <div class="sub"><span><b>${nd.from.length}</b> of your players from here</span><span><b>${nd.played.size}</b> played here</span><span><b>${nd.teams.length}</b> team seasons</span>${nWS ? `<span><b>${nWS}</b> World Series</span>` : ''}${nPen ? `<span><b>${nPen}</b> pennants</span>` : ''}</div>
   <h2>Best players from here</h2>${from.length ? `<div class="list">${from.slice(0, LIM).map(pk => prow(pk, `peak ${D.players[pk].pk || '?'}${nd.lvl < 2 ? ' · ' + esc(fromOf(pk).c || '') : ''}`)).join('')}</div>${from.length > LIM ? `<p class="note">and ${from.length - LIM} more</p>` : ''}` : '<p class="empty">Nobody on your list is from here.</p>'}
   <h2>Best players to play here</h2>${played.length ? `<div class="list">${played.slice(0, LIM).map(([pk, x]) => prow(pk, `${x.y0}${x.y1 !== x.y0 ? '–' + x.y1 : ''} · ${esc([...x.tm].join(', '))}`)).join('')}</div>${played.length > LIM ? `<p class="note">and ${played.length - LIM} more</p>` : ''}` : '<p class="empty">No one from your list played for a team based here.</p>'}
   <h2>Best teams from here <small>by record</small></h2>${teams.length ? `<div class="list">${teams.slice(0, 20).map(([tid, t]) => `<button class="row" onclick="go('t_${tid}')"><span class="yr">${t.y} ${esc(t.lg)}</span><span class="rn">${esc(t.n)}<small>${t.w}–${t.l}${t.ws ? ' · won the World Series' : t.pen ? ' · pennant' : ''}</small></span><span class="meta">${dotsHTML('t_' + tid)}</span></button>`).join('')}</div>` : '<p class="empty">No teams based here in the database.</p>'}
   ${subs.length ? `<h2>${nd.lvl === 0 ? 'States and regions' : 'Cities'}</h2><div class="list">${subs.map(n => `<button class="row" onclick="go('l_${enc(n.k)}')"><span class="rn">${esc(placeLabel(n))}</span><span class="meta">${n.from.length} from · ${n.teams.length} team seasons</span></button>`).join('')}</div>` : ''}`;
}
const notFound = () => `${crumbs('')}<p class="empty">Couldn’t find that one.</p>`;

/* ================================================================ render */
function mapFor() {
  const t = view.type; highlight = null; focusPts = null; let fit = null;
  if (t === 'y') MAPMODE = 'teams';
  if (t === 'y') { const lls = Object.values(D.teams).filter(x => x.y === YEAR && x.ll).map(x => x.ll); if (lls.length) fit = lls; }
  if (t === 'd') { MAPMODE = 'teams'; const d0 = view.id === 'pre' ? 1845 : +view.id; if (YEAR < d0 || YEAR > (view.id === 'pre' ? 1870 : d0 + 9)) { YEAR = view.id === 'pre' ? 1870 : Math.max(d0, 1871); $('#yr').value = YEAR; $('#bigyear').textContent = YEAR; } }
  if (t === 't') { const tm = D.teams[view.id]; if (tm) { MAPMODE = 'teams'; if (YEAR !== tm.y) { YEAR = tm.y; $('#yr').value = YEAR; $('#bigyear').textContent = YEAR; } highlight = 't_' + view.id; if (tm.ll) fit = [tm.ll]; } }
  if (t === 'f') { const fr = D.franch[view.id]; if (fr) { MAPMODE = 'teams'; const last = D.teams[fr.s[fr.s.length - 1]]; YEAR = last.y; $('#yr').value = YEAR; $('#bigyear').textContent = YEAR; highlight = 't_' + fr.s[fr.s.length - 1];
      focusPts = []; const seen = new Set(); for (const tid of fr.s) { const x = D.teams[tid]; if (x.ll && !seen.has(x.ll + '')) { seen.add(x.ll + ''); focusPts.push({ ll: x.ll, label: `${x.n} (${x.y})`, key: 't_' + tid, r: 6 }); } } fit = focusPts.map(x => x.ll); } }
  if (t === 'c') { const c = D.clubs[view.id]; MAPMODE = 'teams'; if (c && c.ll) { focusPts = [{ ll: c.ll, label: c.n, r: 8 }]; fit = [c.ll]; } }
  if (t === 'g') { const g = D.games[view.id]; if (g) { MAPMODE = 'teams'; YEAR = g.y; $('#yr').value = YEAR; $('#bigyear').textContent = YEAR; if (g.tid) { highlight = 't_' + g.tid; const tm = D.teams[g.tid]; if (tm.ll) fit = [tm.ll]; } } }
  if (t === 'p') { MAPMODE = 'players'; highlight = 'p_' + view.id; const p = D.players[view.id]; if (p) { const f = fromOf(view.id); focusPts = [];
      if (f && f.ll) focusPts.push({ ll: f.ll, label: 'From: ' + (f.c || f.r || f.n), r: 7 });
      for (const s of p.st || []) { const tm = D.teams[s[5]]; if (tm && tm.ll) focusPts.push({ ll: tm.ll, label: `${s[2]} ${s[1]}`, key: 't_' + s[5], r: 5 }); }
      for (const c of p.clubs || []) focusPts.push({ ll: [+c[2], +c[3]], label: c[0], r: 5 });
      fit = focusPts.map(x => x.ll); } }
  if (t === 'l') { MAPMODE = 'places'; const k = view.id === 'world' ? null : decodeURIComponent(view.id); placeSel = k;
    if (k && PL[k]) { const lls = Object.values(PL).filter(n => n.lvl === 2 && (n.k === k || n.k.startsWith(k + '|')) && n.lls.length).map(n => n.lls[0]); fit = lls.length ? lls : null; } }
  $('#mapbar').hidden = MAPMODE !== 'teams' || (layoutOf(view) !== 'map' && !FULL);
  $('#ml-teams').setAttribute('aria-pressed', t === 'y'); $('#ml-places').setAttribute('aria-pressed', t === 'l');
  $('#maphint').textContent = { teams: highlight ? `Every team on the field in ${YEAR}` : `Every team on the field in ${YEAR}. Click a badge.`, players: 'Where your players are from', places: 'Cities sized by how many of your players come from them' }[MAPMODE];
  return fit;
}
function render(newView = true, opts = {}) {
  const panel = $('#panel'), t = view.type, st = panel.scrollTop, active = document.activeElement && document.activeElement.id;
  const drafts = {}; for (const id of ['clip-t', 'clip-u', 'rkfilter']) { const el = document.getElementById(id); if (el) drafts[id] = el.value; }
  const V = { d: vDecade, y: vYear, p: vPlayer, t: vTeam, g: vGame, f: vFranchise, c: vClub, r: vList, l: vPlace };
  const lay = layoutOf(view), home = homeOf(view);
  document.body.classList.remove('lay-map', 'lay-page', 'lay-list'); document.body.classList.add('lay-' + lay);
  if (home) lastHome = home;
  for (const h of HOMES) { const b = $('#home-' + h); b.setAttribute('aria-current', h === home); b.classList.toggle('from', !home && h === lastHome); }
  panel.innerHTML = (V[t] || vYear)();
  if (!newView) { scroller().scrollTop = st; for (const [id, v] of Object.entries(drafts)) { const el = document.getElementById(id); if (el && !el.value) el.value = v; } if (active) document.getElementById(active)?.focus(); }
  wire();
  if (newView && !opts.keepMap) placeMap(opts.restore);
  else if (newView) { mapFor(); refreshMap(); }
}
// Size the map for the current layout (full map, corner inset, or none), draw it, and frame what this view is about.
function placeMap(restore) {
  if (layoutOf(view) === 'list' && !FULL) return;
  const want = layoutOf(view) + (FULL ? '+full' : '') + innerWidth;
  if (want !== sizedFor) { sizedFor = want; sizeMap(); }
  const fit = mapFor(); refreshMap();
  if (restore && mapT && homeOf(view) === 'map') svg.call(zoom.transform, mapT);
  else if (fit && fit.length) fitTo(fit, view.type === 't' || view.type === 'g' ? 5 : view.type === 'y' ? 14 : 30); else fitNorthAmerica();
}
function curKey() { return view.type + '_' + view.id; }
function wire() {
  const key = curKey();
  $('#backbtn')?.addEventListener('click', back);
  document.querySelectorAll('.tick').forEach(el => el.addEventListener('change', () => mutate(key, cur => { cur.doors = cur.doors || {}; cur.doors[el.dataset.door] = el.checked ? 1 : 0; })));
  document.querySelectorAll('.scale').forEach(sc => sc.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const tool = sc.dataset.tool, g = b.dataset.grade;
    mutate(key, cur => { cur.grades = cur.grades || {}; if (cur.grades[tool] === g) delete cur.grades[tool]; else cur.grades[tool] = g; }); }));
  $('#clipform')?.addEventListener('submit', e => { e.preventDefault(); const t = $('#clip-t').value.trim(), u = $('#clip-u').value.trim(), k = $('#clip-k').value; if (!t && !u) return;
    $('#clip-t').value = ''; $('#clip-u').value = ''; mutate(key, cur => { (cur.clips = cur.clips || []).push({ t, u, k, at: Date.now() }); }); });
  document.querySelectorAll('[data-delclip]').forEach(b => b.addEventListener('click', () => mutate(key, cur => { cur.clips.splice(+b.dataset.delclip, 1); })));
  // from place
  // home lists
  const st = view.type === 'r' ? RK[view.id] : null;
  document.querySelectorAll('[data-pos]').forEach(b => b.addEventListener('click', () => { st.pos = b.dataset.pos; render(false); }));
  document.querySelectorAll('[data-grp]').forEach(b => b.addEventListener('click', () => { st.grp = b.dataset.grp; st.n = 100; render(false); }));
  document.querySelectorAll('[data-tmode]').forEach(b => b.addEventListener('click', () => { st.mode = b.dataset.tmode; render(false); }));
  $('#tmore')?.addEventListener('click', () => { st.n += 200; render(false); });
  $('#rksort')?.addEventListener('change', e => { st.sort = e.target.value; render(false); });
  $('#rkfilter')?.addEventListener('input', e => { st.f = e.target.value; clearTimeout(window.__rf); window.__rf = setTimeout(() => render(false), 150); });
  document.querySelectorAll('.noteform').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); const t = f.querySelector('.nt').value.trim(), u = f.querySelector('.nu').value.trim(); if (!t && !u) return;
    mutate(key, cur => { cur.notes = cur.notes || {}; (cur.notes[f.dataset.sec] = cur.notes[f.dataset.sec] || []).push({ t, u, at: Date.now() }); }); }));
  document.querySelectorAll('[data-delnote]').forEach(b => b.addEventListener('click', () => { const [sec, i] = b.dataset.delnote.split(':'); mutate(key, cur => { cur.notes[sec].splice(+i, 1); }); }));
  // mark a tracked page complete (or not)
  document.querySelectorAll('[data-done]').forEach(b => b.addEventListener('click', () => { mutate(b.dataset.done, cur => { if (cur.done) delete cur.done; else cur.done = Date.now(); }); scheduleSync(0); }));  // completing a page saves at once
  wireSave();
}
function wireSave() {  // export/import, GitHub
  $('#exportbtn')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ progress: STORE.progress, exportedAt: new Date().toISOString() }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'progress.json'; document.body.appendChild(a); a.click(); a.remove();
    if (!ghToken()) { lsSet(BAK, String(Date.now())); syncUI(); }
    $('#savemsg').textContent = 'Saved progress.json to your downloads.';
  });
  $('#importfile')?.addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); mergeIn(j); persist(); buildPlaces(); render(true); setTimeout(() => { const m = $('#savemsg'); if (m) m.textContent = 'Imported.'; }, 0); }
    catch (err) { $('#savemsg').textContent = 'That file isn’t an atlas progress export.'; } });
  $('#ghform')?.addEventListener('submit', async e => { e.preventDefault(); const t = $('#ghtoken').value.trim(); if (!t) return;
    $('#savemsg').textContent = 'Checking the token…';
    try { await ghConnect(t); render(false); } catch (err) { $('#savemsg').textContent = err.message; } });
  $('#ghsave')?.addEventListener('click', () => ghSave());
  $('#ghoff')?.addEventListener('click', () => { lsSet(GHK, null); clearTimeout(syncT); SYNC.state = 'idle'; syncUI(); render(false); });
}
function spin() {  // a random tracked page you haven't marked complete
  const pool = [...trackKeys().all].filter(k => !isDone(k));
  if (!pool.length) { setNote('Everything on your tracker is complete.'); return; }
  const k = pool[Math.floor(Math.random() * pool.length)];
  go(k.startsWith('l_') ? 'l_' + enc(k.slice(2)) : k);  // place links carry the key encoded
}

/* ================================================================ search */
let IDX = [], selI = 0;
function buildIndex() {
  IDX = [];
  for (const [k, p] of Object.entries(D.players)) IDX.push({ t: nameOf(p), s: `${p.pos} · peak ${p.pk}`, key: 'p_' + k, w: 3 });
  for (const [k, c] of Object.entries(D.clubs || {})) IDX.push({ t: c.n, s: [c.c, c.cn].filter(Boolean).join(', ') || 'club', key: 'c_' + k, w: 1.5 });
  for (const [k, g] of Object.entries(D.games)) IDX.push({ t: `${g.y} ${g.gt || g.g} ${g.d}`, s: 'game #' + g.rk, key: 'g_' + k, w: 1 });
  for (const nd of Object.values(PL)) if (nd.from.length || nd.teams.length > 20) IDX.push({ t: placeLabel(nd), s: ['country', 'state / region', 'city'][nd.lvl] + (nd.lvl ? ' · ' + nd.n : ''), key: 'l_' + enc(nd.k), w: 2 });
}
function doSearch(q) {
  const box = $('#results'); q = q.trim().toLowerCase(); if (q.length < 2) { box.hidden = true; return; }
  const out = [], ym = q.match(/^(1[89]\d\d|20[0-2]\d)\b\s*(.*)$/);
  if (ym && !ym[2]) out.push({ t: 'The ' + ym[1] + ' season', s: 'year', key: 'y_' + ym[1], sc: 9 });
  const dm = q.match(/^(1[89]\d|20[0-2])0s$/); if (dm) out.push({ t: 'The ' + q, s: 'decade', key: 'd_' + dm[1] + '0', sc: 10 });
  if (ym && ym[2]) for (const [tid, t] of Object.entries(D.teams)) if (t.y === +ym[1] && t.n.toLowerCase().includes(ym[2])) out.push({ t: `${t.y} ${t.n}`, s: LG[t.lg] || t.lg, key: 't_' + tid, sc: 8 });
  for (const it of IDX) { const tl = it.t.toLowerCase(); if (tl.includes(q)) out.push({ ...it, sc: (tl.startsWith(q) ? 2 : 0) + (tl.split(' ').some(w => w.startsWith(q)) ? 1 : 0) + it.w }); }
  for (const [fid, fr] of Object.entries(D.franch)) { const names = new Set(fr.s.map(s => D.teams[s].n)); for (const n of names) if (n.toLowerCase().includes(q)) { const s = fr.s.filter(x => D.teams[x].n === n); out.push({ t: n, s: `franchise · ${D.teams[s[0]].y}–${D.teams[s[s.length - 1]].y}`, key: 'f_' + fid, sc: 2.5 }); } }
  out.sort((a, b) => b.sc - a.sc);
  const top = out.slice(0, 12); selI = 0;
  box.innerHTML = top.length ? top.map((r, i) => `<button data-key="${esc(r.key)}" class="${i === 0 ? 'sel' : ''}"><span>${esc(r.t)}</span><small>${esc(r.s)}</small></button>`).join('') : '<div style="padding:10px 12px" class="note">Nothing matches. Try a last name, a team, a city, or a year.</div>';
  box.hidden = false;
  box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { box.hidden = true; $('#q').value = ''; $('#top').classList.remove('searching'); go(b.dataset.key); }));
}

/* ================================================================ play */
let playT = null;
function stopPlay() { if (playT) { clearInterval(playT); playT = null; $('#play').textContent = '▶'; } }

/* ================================================================ boot */
(async function boot() {
  [D, WORLD, STATES, PHOTOS] = await Promise.all([getJSON('data/atlas.json'), getJSON('data/world.json'), getJSON('data/states.json'), getJSON('data/photos.json', {})]);
  NOTES = { ...NOTES, ...(await getJSON('data/notes.json', {})) };
  const [committed, synced] = await Promise.all([getJSON('data/progress.json', {}), ghPull()]);
  loadStore(committed, synced);
  if (ghToken() && unbacked()) scheduleSync(1000);  // changes made here while offline or before connecting
  buildPlaces(); buildIndex();
  setupMap();
  addEventListener('resize', () => { clearTimeout(window.__rs); window.__rs = setTimeout(() => placeMap(false), 200); });
  $('#yr').addEventListener('input', e => { stopPlay(); setYear(+e.target.value); });
  $('#play').addEventListener('click', () => { if (playT) { stopPlay(); return; } $('#play').textContent = '❚❚'; if (view.type !== 'y') go('y_' + YEAR); playT = setInterval(() => { if (YEAR >= 2025) { stopPlay(); return; } setYear(YEAR + 1); }, 650); });
  $('#q').addEventListener('input', e => doSearch(e.target.value));
  $('#q').addEventListener('keydown', e => { const bs = [...$('#results').querySelectorAll('button')]; if (!bs.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); selI = (selI + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length; bs.forEach((b, i) => b.classList.toggle('sel', i === selI)); }
    if (e.key === 'Enter') { e.preventDefault(); bs[selI].click(); } if (e.key === 'Escape') $('#results').hidden = true; });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) $('#results').hidden = true; });
  $('#home').addEventListener('click', () => goHome('map')); $('#home').addEventListener('keydown', e => { if (e.key === 'Enter') goHome('map'); });
  for (const h of HOMES) $('#home-' + h).addEventListener('click', () => goHome(h));
  $('#ml-teams').addEventListener('click', () => go('y_' + YEAR)); $('#ml-places').addEventListener('click', () => go('l_world'));
  for (const id of ['#mapexpand', '#mapfab']) $(id).addEventListener('click', () => setFull(true));
  $('#mapclose').addEventListener('click', () => setFull(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && FULL) setFull(false); });
  $('#spin').addEventListener('click', spin);
  $('#syncbtn').addEventListener('click', () => { goHome('tracker'); setTimeout(() => $('#savebox')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); });
  addEventListener('visibilitychange', () => { if (document.hidden && SYNC.state === 'pending') ghSave(); });  // leaving: save now
  addEventListener('beforeunload', e => { if (SYNC.state === 'pending' || SYNC.state === 'saving') { ghSave(); e.preventDefault(); } });  // still saving: ask before closing
  syncUI();
  $('#yprev').addEventListener('click', () => { stopPlay(); setYear(YEAR - 1); });
  $('#ynext').addEventListener('click', () => { stopPlay(); setYear(YEAR + 1); });
  $('#searchbtn').addEventListener('click', () => { const on = $('#top').classList.toggle('searching'); if (on) $('#q').focus(); });
  $('#q').addEventListener('blur', () => setTimeout(() => { if (!$('#q').value) $('#top').classList.remove('searching'); }, 200));
  const hv = viewFromHash();
  if (hv) { view = hv; if (hv.type === 'y') YEAR = +hv.id; }
  history.scrollRestoration = 'manual';
  try { history.replaceState({ d: history.state?.d || 0 }, '', hashOf(view)); } catch (e) { }
  addEventListener('popstate', onPop);
  if (homeOf(view) === 'map') lastMap = view;
  $('#yr').value = YEAR; $('#bigyear').textContent = YEAR;
  render(true);
})();
