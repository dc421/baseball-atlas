"use strict";
/* Living Atlas of Baseball
   Data: data/atlas.json (built by scripts/build_data.py), data/photos.json (scripts/fetch_photos.py), data/parks.json (scripts/fetch_parks.py),
   data/pages.json (each edited page's own copy and whether it's locked). */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const getJSON = (u, fallback) => fetch(u).then(r => r.ok ? r.json() : fallback).catch(() => fallback);

let ROSTERS = null, rosterLoad = null, BOXES = null, boxLoad = null;  // + data/games.json (line scores), on first game page  // data/rosters.json, fetched when a team page first opens
let D, WORLD, STATES, PHOTOS = {}, PARKS = {}, NOTES = { pre: [], years: {}, decades: {}, players: {} };
const LG = { NA: 'National Association', NL: 'National League', AL: 'American League', AA: 'American Association', UA: 'Union Association', PL: "Players' League", FL: 'Federal League', NNL: 'Negro National League', NN2: 'Negro National League (II)', ECL: 'Eastern Colored League', ANL: 'American Negro League', EWL: 'East-West League', NSL: 'Negro Southern League', NAL: 'Negro American League', EAS: 'Eastern independent clubs', WES: 'Western independent clubs', IND: 'Independent clubs', NAC: 'Negro American (Cuban) clubs', INT: 'Interracial independents' };
const POSP = new Set(['SP', 'RP']);
const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'SP', 'RP'];
const nameOf = p => p.f + ' ' + p.l;
const initials = p => (p.f[0] || '') + (p.l[0] || '');
const ordinal = n => { n = +n; const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const rankLabel = p => p.ovr ? `#${p.ovr} ${p.pos}` : typeof p.prk === 'number' ? `${p.pos} #${p.prk}` : `${p.prk || ''} ${p.pos}`;
const wpct = t => (t.w + t.l) ? t.w / (t.w + t.l) : 0;

/* ================================================================ pages
   Every page starts as a draft built from the data. The first edit (moving, rewriting, adding or removing something) gives
   the page its own copy in data/pages.json, which wins over the data from then on; locking it hides the editing tools.
   Editing needs a GitHub token in this browser (open #r-tracker); edits save straight to docs/data/pages.json on main, so the
   live site follows a minute or so later. Without a token the site is read-only and every page shows clean.
   Entries merge per page: the newer one wins. */
const LS = 'atlas-pages-v1', GHK = 'atlas-gh-token';
const GH = { repo: 'dc421/baseball-atlas', branch: 'main', path: 'docs/data/pages.json' };
const STORE = { pages: {} };
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } };
function mergeIn(src) {  // -> how many pages changed
  let n = 0;
  for (const [k, v] of Object.entries(src?.pages || {})) if (!STORE.pages[k] || (v.at || 0) > (STORE.pages[k].at || 0)) { STORE.pages[k] = v; n++; }
  return n;
}
function loadStore(...saved) {  // the published and fresh copies, then this browser's unsaved edits
  for (const src of saved) mergeIn(src);
  try { const local = JSON.parse(lsGet(LS) || 'null'); if (local) mergeIn(local); } catch (e) { }
}
let saveT = null, rev = 0;
const dirty = new Set();  // pages edited since the last save, for the commit message
function persist(sync = true) {
  clearTimeout(saveT); if (sync) rev++;
  saveT = setTimeout(() => { try { localStorage.setItem(LS, JSON.stringify({ ...STORE, savedAt: Date.now() })); } catch (e) { } }, 250);
  if (sync) scheduleSync(); syncUI();
}

/* ---------------------------------------------------------------- GitHub */
const ghToken = () => lsGet(GHK);
const editing = () => !!ghToken();
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
function scheduleSync(ms = 2000) {
  if (!ghToken()) return;
  clearTimeout(syncT); SYNC.state = 'pending'; syncT = setTimeout(ghSave, ms);
}
const keyName = k => { const e = ent(k); return e ? e.type === 'p' ? nameOf(e.o) : e.type === 't' ? `${e.o.y} ${e.o.n}` : e.type === 'g' ? `${e.o.y} ${e.o.gt || e.o.g}` : e.o.n || k : k; };
async function ghSave() {
  if (!ghToken()) return;
  if (syncing) return scheduleSync();
  clearTimeout(syncT); syncing = true; SYNC.state = 'saving'; syncUI();
  const r0 = rev, keys = [...dirty];
  try {
    for (let tries = 0; ; tries++) {
      // write straight over the copy we last saw; only read first when we haven't seen it or another device has saved since
      if (!ghSha) {
        const remote = await ghRead();
        if (mergeIn(remote.data)) { persist(false); refreshMap(); if (!document.activeElement?.matches('input,textarea,select')) render(false); }
        if (remote.sha && JSON.stringify(remote.data.pages || {}) === JSON.stringify(STORE.pages)) break;  // nothing new to save
      }
      const body = JSON.stringify({ pages: STORE.pages }, null, 1) + '\n';
      const what = keys.map(k => `${STORE.pages[k]?.locked ? 'lock' : 'edit'} ${keyName(k)}`);
      const message = what.length ? what.slice(0, 3).join(', ').replace(/^./, c => c.toUpperCase()) + (what.length > 3 ? ` and ${what.length - 3} more` : '') : 'Save page edits';
      const r = await ghAPI(`contents/${GH.path}`, { method: 'PUT', keepalive: body.length < 60000,
        body: JSON.stringify({ message, content: b64(body), branch: GH.branch, ...(ghSha ? { sha: ghSha } : {}) }) });
      if (r.ok) { ghSha = (await r.json()).content?.sha || null; break; }
      if ((r.status === 409 || r.status === 422) && tries < 3) { ghSha = null; continue; }  // another device saved in between: read, merge, write again
      throw ghFail(r);
    }
    for (const k of keys) dirty.delete(k);
    Object.assign(SYNC, { state: 'saved', at: Date.now(), err: '' });
  } catch (e) {
    Object.assign(SYNC, { state: 'error', err: e.message || 'Couldn’t reach GitHub' });
    if (e.status !== 401 && e.status !== 403) scheduleSync(60000);  // offline or GitHub hiccup: try again in a minute
  }
  syncing = false; syncUI(); refreshSaveBox();
  if (rev !== r0 && SYNC.state === 'saved') scheduleSync();
}
async function ghPull() {  // on load, with a token: the current file (the published copy can lag a minute behind a save)
  if (!ghToken()) return {};
  try { const r = await ghRead(); SYNC.state = 'saved'; SYNC.at = Date.now(); return r.data; }
  catch (e) { Object.assign(SYNC, { state: 'error', err: e.message }); return {}; }
}
async function ghConnect(token) {
  lsSet(GHK, token);
  const r = await ghAPI('').catch(() => null);
  if (!r || !r.ok || !(await r.json()).permissions?.push) { lsSet(GHK, null); throw new Error(r && r.status === 401 ? 'GitHub didn’t accept that token.' : 'That token can’t write to ' + GH.repo + '.'); }
  mergeIn(await ghPull()); editUI();
}
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' hr ago' : Math.round(s / 86400) + ' days ago'; };
function syncUI() {  // the header pill: whether the latest edits are on GitHub
  const b = $('#syncbtn'); if (!b) return;
  const st = ghToken() ? SYNC.state : 'idle';
  const label = { pending: 'Saving…', saving: 'Saving…', saved: 'Saved', error: 'Not saved', idle: '' }[st];
  b.hidden = !label; b.dataset.st = st; b.querySelector('span').textContent = label;
  b.title = st === 'error' ? SYNC.err + '. Open the save settings.' : st === 'saved' ? 'Edits saved to GitHub' + (SYNC.at ? ' ' + ago(SYNC.at) : '') : 'Saving edits to GitHub';
}
function editUI() {  // what only shows while editing: the Tracker tab and the map's locked/draft key
  document.body.classList.toggle('editing', editing());
  $('#home-tracker').hidden = !editing();
}
const pg = key => STORE.pages[key];
function mutate(key, fn) {
  const cur = structuredClone(STORE.pages[key] || {});
  fn(cur); cur.at = Date.now(); STORE.pages[key] = cur; dirty.add(key); persist(); refreshMap(); render(false);
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
function fromOf(k) { const p = D.players[k]; return p.from ? { ...p.from, ll: p.ll } : null; }

/* ---------------- research links ---------------- */
const yt = q => 'https://www.youtube.com/results?search_query=' + enc(q);
const img = q => 'https://www.google.com/search?tbm=isch&q=' + enc(q);
const gg = q => 'https://www.google.com/search?q=' + enc(q);
const wiki = q => 'https://en.wikipedia.org/w/index.php?search=' + enc(q);
const sabr = q => 'https://sabr.org/?s=' + enc(q);
const loc = q => 'https://www.loc.gov/collections/chronicling-america/?q=' + enc(q);
const books = q => 'https://www.google.com/search?tbm=bks&q=' + enc(q);
// a page is finished when it's locked; everything starts as a draft
const isLocked = key => !!pg(key)?.locked;
const canEdit = key => editing() && !isLocked(key);
const litN = key => isLocked(key) ? 3 : 0;
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
// editing only: whether the page is locked, and the switch
const lockHTML = key => editing() && trackKeys().all.has(key)
  ? `${!isLocked(key) ? `<span class="pagestate">${pg(key) ? 'Draft, edited' : 'Draft'}</span>` : ''}<button class="donebtn" data-lock="${esc(key)}" aria-pressed="${isLocked(key)}" title="${isLocked(key) ? 'Unlock to edit again' : 'Lock it in: hides the editing tools'}"><span class="box" aria-hidden="true"></span>${isLocked(key) ? 'Locked' : 'Lock page'}</button>` : '';

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
let YEAR = 2025, MAPMODE = 'teams', highlight = null, focusPts = null;

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
let view = { type: 'y', id: '2025' };
const HOMES = ['map', 'teams', 'players', 'games', 'tracker'];
const homeOf = v => 'yld'.includes(v.type) ? 'map' : v.type === 'r' ? v.id : null;
const layoutOf = v => 'yld'.includes(v.type) ? 'map' : v.type === 'r' || v.type === 'g' ? 'list' : 'page';  // game pages: no map
let lastHome = 'map', lastMap = { type: 'y', id: '2025' }, mapT = null, FULL = false, sizedFor = '';
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
  key = pageKey(key); TL_EDIT = null;
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
  stopPlay(); leave(); setFull(false, false); TL_EDIT = null;
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
// the scouting card: the model's 20-80 tools
const CARD = [['hit_tool', 'Hit'], ['power', 'Power'], ['speed', 'Run'], ['fielding', 'Field'], ['K_plus', 'Fastball', 'from strikeout rate'], ['BB_plus', 'Control', 'from walk rate'], ['dur', 'Durability']];
function cardHTML(p) {
  const ts = CARD.filter(([c]) => p.tools?.[c] != null); if (!ts.length) return '';
  return `<div class="card80"><div class="kind">Scouting card <small>20–80, the model</small></div>${ts.map(([c, l, why]) => { const v = p.tools[c];
    return `<div class="tool80"${why ? ` title="${why}"` : ''}><span>${l}</span><i><b style="width:${Math.max(0, Math.min(1, (v - 20) / 60)) * 100}%"></b></i><span class="v">${v}</span></div>`; }).join('')}</div>`;
}
/* ================================================================ the rating model
   One rating for players: projected WAR per 150 games, era-adjusted before the war (scripts/build_data.py).
   Team scores are wins over an average team. Relievers keep a per-batter rate. */
const TIERS = [[6.225, 'All-timer'], [5.64, 'Safely in'], [5.19, 'Borderline in'], [4.74, 'Borderline out'], [-Infinity, 'Out']];
const tierOf = s => TIERS.find(t => s > t[0])[1];
const fmtS = s => (s > 0 ? '+' : '') + s.toFixed(1);
const fmtR = s => s == null ? '' : s.toFixed(1);
const RATING = 'Projected WAR per 150 games';
// a year's ranked players: [name, key, rating, pos, team season, 'war' for war-service credit]; rel: the reliever row
function modelList(lst, start = 0, rel = false) {
  return `<div class="list">${lst.map((e, i) => { const [nm, k, s, pos, tid, war] = e, tm = war ? 'military service' : tid && D.teams[tid] ? D.teams[tid].n : '';
    const inner = `${k ? avatar(k) : '<span class="avatar">·</span>'}<span class="yr">${rel ? 'RP' : `#${i + 1 + start} ${esc(pos || '')}`}</span><span class="rn">${esc(nm)}${tm ? `<small>${esc(tm)}</small>` : ''}</span><span class="meta">${rel ? '' : `<span title="${RATING}">${fmtR(s)}</span>`}</span>`;
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
  const hit = rows => `<table class="stats roster"><tr><th>Pos</th><th class="nm">Player</th><th>G</th><th>HR</th><th>AVG</th><th>OBP</th><th>SLG</th><th title="${RATING}">Rating</th></tr>${rows.map(e => `<tr><td>${e[0]}</td><td class="nm">${nm(e.slice(1))}</td><td>${e[4]}</td><td>${e[5]}</td><td>${e[6]}</td><td>${e[7]}</td><td>${e[8]}</td><td>${war(e[3])}</td></tr>`).join('')}</table>`;
  const pit = (rows, rot) => `<table class="stats roster"><tr><th class="nm">Player</th><th>G</th><th>${rot ? 'GS' : 'SV'}</th><th>W–L</th><th>IP</th><th>ERA</th><th title="${RATING}">Rating</th></tr>${rows.map(e => `<tr><td class="nm">${nm(e)}</td><td>${e[3]}</td><td>${rot ? e[4] : e[7]}</td><td>${e[5]}–${e[6]}</td><td>${e[8]}</td><td>${e[9]}</td><td>${war(e[2])}</td></tr>`).join('')}</table>`;
  return `<h2>Lineup <small>most games at each position</small></h2><div class="statline">${hit(r.L)}</div>
   ${r.R.length ? `<h2>Rotation</h2><div class="statline">${pit(r.R, true)}</div>` : ''}
   ${r.P.length ? `<h2>Bullpen</h2><div class="statline">${pit(r.P, false)}</div>` : ''}
   ${r.B.length ? `<h2>Bench</h2><div class="statline">${hit(r.B)}</div>` : ''}`;
}
/* ================================================================ tracker
   Only while editing: how many pages of each kind are locked, and a spin for each (see trackKeys for what's tracked). */
function vTracker() {
  if (!editing()) return `${banner()}<h1 class="name">Edit this site</h1>${saveBox()}`;
  const K = trackKeys(), done = keys => keys.filter(isLocked).length, edited = keys => keys.filter(k => pg(k) && !isLocked(k)).length;
  const types = [['Players', K.P, 'the list'], ['Team seasons', K.T, `the top ${K.T.length} by the model, one per season played (1869 included)`], ['Games', K.G, `the top ${K.G.length}`],
    ['Years', K.Y, 'every season since 1869'], ['Decades', K.Dc, 'before 1871 is one page'], ['Franchises', K.F, 'every franchise'], ['Places of origin', K.Pl, 'the US states and other countries the players are from']];
  const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
  const bar = (d, n) => `<div class="tbar" title="${d} of ${n} locked"><i class="d" style="width:${100 * d / (n || 1)}%"></i></div>`;
  const row = ([label, keys, note], i) => { const d = done(keys), e = edited(keys); return `<tr><td>${label}${note ? `<small>${note}</small>` : ''}</td><td><b>${d}</b>/${keys.length} <span class="pc">${pct(d, keys.length)}%</span>${e ? `<small>${e} in progress</small>` : ''}</td><td class="wide">${bar(d, keys.length)}</td>${i != null ? `<td><button class="btn ghost" data-spin="${i}">Spin</button></td>` : ''}</tr>`; };
  // year grid: each tracked season's pages (year, best team, its tracked games, your top 5 that year)
  const yItems = {}, add = (y, k) => (yItems[y] = yItems[y] || new Set()).add(k);
  for (const k of K.Y) add(+k.slice(2), k);
  for (const k of K.T) add(D.teams[k.slice(2)].y, k);
  for (const k of K.G) add(D.games[k.slice(2)].y, k);
  for (const [y, yd] of Object.entries(D.years)) if (yItems[y]) for (const e of [...(yd.mH || []).slice(0, 5), ...(yd.mP || []).slice(0, 5)]) if (e[1]) add(+y, 'p_' + e[1]);
  const years = Object.keys(yItems).map(Number).sort((a, b) => a - b), yf = y => { const ks = [...yItems[y]]; return ks.filter(isLocked).length / ks.length; };
  const step = f => f === 0 ? 0 : f < .34 ? 1 : f < .67 ? 2 : f < 1 ? 3 : 4, grid = [];
  for (let d = Math.floor(years[0] / 10) * 10; d <= years[years.length - 1]; d += 10) grid.push(`<div class="yg-row"><span class="yg-d">${d}s</span>${[...Array(10)].map((_, i) => { const y = d + i;
    return yItems[y] ? `<button class="yg s${step(yf(y))}" onclick="go('y_${y}')" title="${y}: ${[...yItems[y]].filter(isLocked).length} of ${yItems[y].size} locked"><span>${String(y).slice(2)}</span></button>` : '<span class="yg none"></span>'; }).join('')}</div>`);
  const byPos = POSITIONS.map(pos => { const ks = K.P.filter(k => D.players[k.slice(2)].pos === pos); return [pos, ks]; }).filter(x => x[1].length);
  const next = (keys, rank) => keys.filter(k => !isLocked(k)).sort((a, b) => rank(a) - rank(b)).slice(0, 5);
  const nP = next(K.P, k => D.players[k.slice(2)].ovr || 999), nT = next(K.T, k => D.teams[k.slice(2)].tr?.ar ?? 0), nG = next(K.G, k => D.games[k.slice(2)].rk);
  const nextRow = k => { const e = ent(k), o = e.o;
    const [a, b] = e.type === 'p' ? [rankLabel(o), nameOf(o)] : e.type === 't' ? [o.tr ? `#${o.tr.ar}` : String(o.y), `${o.y} ${o.n}`] : [`#${o.rk}`, `${o.y} ${o.gt || o.g}${o.d ? ' · ' + o.d : ''}`];
    return `<button class="row" onclick="go('${k}')"><span class="yr">${esc(a)}</span><span class="rn">${esc(b)}</span></button>`; };
  const all = [...K.all], allDone = done(all);
  TRACK_TYPES = types.map(t => t[1]);
  const wip = all.filter(k => pg(k) && !isLocked(k));
  return `${banner()}<div class="eyebrow">Building the site</div><h1 class="name">Tracker</h1>
   <p class="note">Every page starts as a draft built from the data. Edit it until it’s right, then lock it.</p>
   <div class="overall"><div class="big"><b>${allDone}</b> of ${all.length} pages locked <span class="pc">${pct(allDone, all.length)}%</span></div>${bar(allDone, all.length)}</div>
   ${wip.length ? `<h2>In progress <small>edited, not locked</small></h2><div class="list">${wip.map(k => `<button class="row" onclick="go('${k}')"><span class="rn">${esc(keyName(k))}</span><span class="meta">${ago(pg(k).at)}</span></button>`).join('')}</div>` : ''}
   <h2>By page type</h2>
   <table class="track"><tr><th></th><th>Locked</th><th class="wide"></th><th></th></tr>${types.map(row).join('')}</table>
   <h2>Year by year <small>each season’s year page, best team, games and top 5</small></h2>
   <div class="ygrid">${grid.join('')}</div>
   <div class="tlegend"><span><i class="yg s0"></i>none</span><span><i class="yg s1"></i>some</span><span><i class="yg s2"></i>a third</span><span><i class="yg s3"></i>two thirds</span><span><i class="yg s4"></i>all</span></div>
   <h2>Players by position</h2>
   <table class="track">${byPos.map(([pos, ks]) => row([pos, ks])).join('')}</table>
   <h2>Next up <small>the highest-ranked not yet locked</small></h2>
   ${nP.length ? `<h3 class="sm">Players, by the list</h3><div class="list">${nP.map(nextRow).join('')}</div>` : ''}
   ${nT.length ? `<h3 class="sm">Team seasons, best first by the model</h3><div class="list">${nT.map(nextRow).join('')}</div>` : ''}
   ${nG.length ? `<h3 class="sm">Games, by the list</h3><div class="list">${nG.map(nextRow).join('')}</div>` : ''}
   ${saveBox()}`;
}
function avatar(k) { const p = D.players[k], ph = PHOTOS[k]; return `<span class="avatar">${ph ? `<img src="photos/${esc(ph.file)}" alt="" loading="lazy">` : esc(initials(p))}</span>`; }
function playerChip(k) { const p = D.players[k]; return p ? `<button class="chip ${litN('p_' + k) ? 'lit' : ''}" onclick="go('p_${k}')"><span class="k">${esc(p.pos)}</span>${esc(nameOf(p))}</button>` : ''; }
function teamBadge(t) {
  const logo = logoFor(t), [bg, fg] = teamColors(t);
  return logo ? `<span class="teambadge"><img src="logos/${esc(logo)}" alt=""></span>` : `<span class="teambadge" style="background:${bg};color:${fg}">${esc(t.br || t.tm)}</span>`;
}
const crumbs = (label, key) => `<div class="crumbs">${depth() ? `<button id="backbtn">← Back</button><span>·</span>` : ''}<span>${esc(label)}</span>${key ? `<span class="grow"></span>${lockHTML(key)}` : ''}</div>`;
const pagebar = key => { const d = lockHTML(key); return d ? `<div class="crumbs"><span class="grow"></span>${d}</div>` : ''; };
// a section of found material (a story, links to look further); without anything in it, it only shows while editing
const section = (title, links = [], body = '', sub = false) => body || editing()
  ? `${sub ? '<h3 class="sm">' : '<h2>'}${title}${links.length ? ` <small class="find">${links.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)} ↗</a>`).join(' · ')}</small>` : ''}${sub ? '</h3>' : '</h2>'}${body}` : '';
const banner = () => `<div class="banner" id="dbnote" ${note ? '' : 'hidden'}>${esc(note)}</div>`;
function gameRow(g) { return `<button class="row" onclick="go('g_${g.rk}')"><span class="yr">${g.y}</span><span class="rn">${esc(g.gt || g.g)}${g.d ? `<small>${esc(g.d)}</small>` : ''}<small>${g.o ? 'from the “Others” row' : `#${g.rk} on the list`}</small></span></button>`; }
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
   ${champs.length ? `<div class="list">${champs.map(([y, tid, t]) => `<button class="row" onclick="go('t_${tid}')">${badgeSm(t)}<span class="yr">${y}</span><span class="rn">${esc(t.n)}<small>${t.w ?? '?'}–${t.l ?? '?'}${t.ws ? ' · won the World Series' : t.pen ? ' · pennant' : ' · first place'}</small></span></button>`).join('')}</div>` : ''}`;
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
  ${eras.length ? `<h2>Era notes</h2><div class="list">${eras.map(e => `<div class="row" style="cursor:default"><span class="yr">${e[0]}${e[1] !== e[0] ? '–' + e[1] : ''}</span><span class="rn">${esc(e[2])}</span></div>`).join('')}</div>
  ${leaguesOf(eras, y0, y1).map(l => leagueSection('d_' + d, l, y0, y1)).join('')}` : ''}
  ${pre ? `<h2>History <small>the game before the leagues</small></h2>${writeup(NOTES.pre, 4)}` : ''}
  ${years.length ? `<h2>Year by year <small>rule changes and notes</small></h2><div class="years">${years.map(yearRow).join('')}</div>` : ''}
  ${dn.text && dn.text.length ? `<h2>Write-up</h2>${writeup(dn.text)}` : ''}`;
}
function vYear() {
  const y = +view.id; if (YEAR !== y) { YEAR = y; $('#yr').value = y; $('#bigyear').textContent = y; }
  const yd = D.years[y] || {}, era = D.eras.find(e => y >= e[0] && y <= e[1]);
  const tms = Object.entries(D.teams).filter(([, t]) => t.y === y);
  const lgs = [...new Set(tms.map(([, t]) => t.lg))];
  const ws = tms.filter(([, t]) => t.ws), pen = tms.filter(([, t]) => t.pen && !t.ws);
  const wpa = (yd.top || []).find(e => e[0] === 'WPA'), mH = yd.mH || [], mP = yd.mP || [];
  const gms = (yd.games || []).map(r => D.games[r]).sort((a, b) => b.gr - a.gr || a.rk - b.rk);
  const yn = NOTES.years[y] || {};
  const champ = ([tid, t]) => `<button class="row" onclick="go('t_${tid}')">${badgeSm(t)}<span class="rn">${esc(t.n)}<small>${t.ws ? 'won the World Series' : esc(t.lg) + ' pennant'}${t.w != null ? ` · ${t.w}–${t.l}` : ''}</small></span></button>`;
  return `${pagebar('y_' + y)}${banner()}<div class="eyebrow">${y} · <a href="#" onclick="go('d_${decadeOf(y)}');return false">the ${decadeName(decadeOf(y))}</a></div>
  <div class="sub" style="margin-top:4px"><span><b>${tms.length}</b> teams</span>${editing() ? `<span><b>${tms.filter(([tid]) => litN('t_' + tid)).length}</b> locked</span>` : ''}${lgs.length ? `<span>${lgs.map(l => esc(l)).join(' · ')}</span>` : ''}</div>
  ${ws.length || pen.length ? `<h2>Champions</h2><div class="list">${[...ws, ...pen].map(champ).join('')}</div>` : ''}
  ${tms.some(([, t]) => t.tr) ? `<h2>Teams by the model <small>talent and results</small></h2><div class="list">${tms.filter(([, t]) => t.tr).sort((a, b) => a[1].tr.yr - b[1].tr.yr).slice(0, 8).map((e, i) => teamRankRow(e, i, false)).join('')}</div>` : ''}
  ${mH.length ? `<h2>Top 5 <small>position players</small></h2>${modelList(mH.slice(0, 5))}` : ''}
  ${mP.length ? `<h2>Top 5 <small>pitchers</small></h2>${modelList(mP.slice(0, 5))}${yd.mRP ? modelList([yd.mRP], 0, true) : ''}` : ''}
  ${mH.length > 5 || mP.length > 5 ? `<details class="allteams"><summary>The next five</summary>
    ${mH.length > 5 ? `<h3 class="sm">Position players</h3>${modelList(mH.slice(5), 5)}` : ''}
    ${mP.length > 5 ? `<h3 class="sm">Pitchers</h3>${modelList(mP.slice(5), 5)}` : ''}</details>` : ''}
  ${wpa ? `<p class="note">cWPA leader: ${wpa[5] ? `<a href="#" onclick="go('p_${wpa[5]}');return false">${esc(wpa[3])}</a>` : esc(wpa[3])}</p>` : ''}
  ${gms.length ? `<h2>Great games</h2><div class="list">${gms.map(gameRow).join('')}</div>` : ''}
  ${yn.quick && yn.quick.length ? `<h2>Changes and notes</h2>${quickList(yn.quick)}` : ''}
  ${yn.text && yn.text.length ? `<h2>Write-up</h2>${writeup(yn.text)}` : ''}
  ${era ? `<h2>Era notes <small>${era[0]}${era[1] !== era[0] ? '–' + era[1] : ''}</small></h2><p style="margin:0">${esc(era[2])}</p>${era[3] ? `<p class="note" style="margin-top:4px">Black clubs and independents: ${esc(era[3])}</p>` : ''}` : ''}
  ${tms.length ? `<details class="allteams"><summary>All ${tms.length} teams</summary><div class="chips">${tms.sort((a, b) => a[1].lg.localeCompare(b[1].lg) || a[1].rk - b[1].rk).map(([tid, t]) => `<button class="chip ${litN('t_' + tid) ? 'lit' : ''}" onclick="go('t_${tid}')"><span class="k">${esc(t.lg)}</span>${esc(t.n)}</button>`).join('')}</div></details>` : `<p class="empty">No league teams in the database this year. The era notes are the way in.</p>`}`;
}
let TRACK_TYPES = [];
function saveBox() {
  const tok = ghToken();
  const status = tok ? (SYNC.state === 'error' ? `<b class="bad">Not saved: ${esc(SYNC.err)}.</b> It’ll keep trying; the edits are kept in this browser meanwhile.`
      : `Editing. Edits save to <code>${GH.path}</code> on <code>${GH.branch}</code> as you go, and the live site follows a minute or so later. ${SYNC.at ? 'Last saved ' + ago(SYNC.at) + '.' : ''}`)
    : `Paste a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token ↗</a> with access to only <code>${GH.repo}</code> and <b>Contents: Read and write</b> to turn on editing in this browser. Visitors never see the editing tools.`;
  const connect = tok ? `<button class="btn ghost" id="ghsave">Save now</button><button class="btn ghost" id="ghoff">Stop editing here</button>`
    : `<form id="ghform" class="r"><input class="t" id="ghtoken" type="password" placeholder="github_pat_…" autocomplete="off"><button class="btn" type="submit">Start editing</button></form>`;
  return `<div class="savebox" id="savebox"><div>${status}</div><div class="r">${connect}<span id="savemsg"></span></div></div>`;
}
function refreshSaveBox() { const b = $('#savebox'); if (b && !b.contains(document.activeElement)) { b.outerHTML = saveBox(); wireSave(); } }

function vPlayer() {
  const k = view.id, p = D.players[k]; if (!p) return notFound();
  const key = 'p_' + k, ph = PHOTOS[k], f = fromOf(k), n = nameOf(p), ed = canEdit(key);
  const m = p.mr, pk = m?.pk || p.pk;
  const rank = [...(m ? m.rel ? [`#${m.rk} among relievers`] : [`#${m.rk} overall`, `#${m.prk} ${esc(m.pos)}`]
    : [p.ovr ? `#${p.ovr} overall` : typeof p.prk === 'string' ? `List group ${esc(p.prk)}` : '', typeof p.prk === 'number' ? `#${p.prk} ${esc(p.pos)}` : esc(p.pos)]),
    `peak ${pk ? `<a href="#" onclick="go('y_${pk}');return false">${pk}</a>` : '?'}`].filter(Boolean).join(' · ');
  const ht = p.ht ? `${Math.floor(p.ht / 12)}′${p.ht % 12}″${p.wt ? ', ' + p.wt + ' lb' : ''}` : '';
  const bornHere = f && p.bplace && placeText(f) === p.bplace;
  const facts = [p.born || p.bplace ? `Born${p.born ? ' ' + p.born.slice(0, 4) : ''}${p.bplace ? ' in ' + (bornHere ? placeLink(f) : esc(p.bplace)) : ''}` : '',
    f && !bornHere ? `From ${placeLink(f)}` : '', p.died ? `Died ${p.died.slice(0, 4)}` : '', ht, p.bt && p.bt !== '?/?' ? `Bats/Throws ${esc(p.bt)}` : ''].filter(Boolean);
  const br = p.br ? `https://www.baseball-reference.com/players/${p.br[0]}/${p.br}.shtml` : `https://www.baseball-reference.com/search/search.fcgi?search=${enc(n)}`;
  const find = [['YouTube', yt(n + ((p.pk || 2000) < 1925 ? ' baseball footage' : ' highlights'))], ['Interviews', yt(n + ' interview')], ['Images', img(n + ' baseball')]];
  return `${crumbs('Player', key)}${banner()}
   <div class="hero">${ph ? `<figure class="photo" style="margin:0"><img src="photos/${esc(ph.file)}" alt="${esc(n)}" title="Photo: ${esc(ph.credit || 'unknown')}${ph.license ? ' · ' + esc(ph.license) : ''}"></figure>` : ''}
   <div class="who"><div class="eyebrow">${rank}</div><h1 class="name">${esc(n)}</h1>
   ${facts.length ? `<div class="sub">${facts.map(x => `<span>${x}</span>`).join('')}</div>` : ''}</div></div>
   ${bioHTML(p, k, [['Baseball-Reference', br], ['SABR biography', sabr(n)], ['Wikipedia', wiki(n + ' baseball')], ['A biography', books(n + ' biography')], ['Old newspapers', loc(n)]], itemsOf(k), ed)}
   ${ed ? `<h3 class="sm">Add to the timeline <small class="find">${find.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)} ↗</a>`).join(' · ')}</small></h3>${itemForm({ k: 'story' }, true)}` : ''}`;
}
// when each story happened: the first year it names within his lifetime; an undated career story takes its
// neighbor's year (the career lists run in order) unless it's about his youth; an undated story about the person goes before the career if
// it's about his youth, and just after it otherwise (y null)
const EARLY = /\b(born|grew up|boyhood|childhood|as a boy|as a child|high school|college|university|tryout|his parents|his father|his mother|immigrants?|youth|teenager|sandlots?)\b/i;
const yearIn = (t, b, d) => { for (const x of String(t || '').matchAll(/\b(18[4-9]\d|19\d\d|20[0-2]\d)\b/g)) if (+x[1] >= b && +x[1] <= d) return +x[1]; return null; };
function datedStories(p, y0) {
  const b = p.born ? +p.born.slice(0, 4) : (y0 || 1900) - 25, d = p.died ? +p.died.slice(0, 4) : 2026;
  const yr = t => yearIn(t, b, d);
  const c = (p.sto?.c || []).map(x => ({ x, y: yr(x[0]) }));
  const dated = c.filter(o => o.y != null);
  c.forEach((o, i) => { if (o.y == null) o.y = EARLY.test(o.x[0]) ? b : ([...c.slice(0, i)].reverse().find(q => dated.includes(q)) || c.slice(i).find(q => dated.includes(q)) || { y: y0 }).y; });
  return [...c, ...(p.sto?.p || []).map(x => { const y = yr(x[0]); return { x, y: y ?? (EARLY.test(x[0]) ? b : null) }; })];
}
/* ---------------- the timeline
   Everything on a player page sits at a year: stories, paragraphs from the history doc, photos, video, the scouting card at
   his peak. Items without a year come after the career. seedItems is the draft from the data; the first edit copies it into
   the page's own items (data/pages.json), which win from then on, so refetching stories or media never changes an edited page. */
const ytId = u => (String(u).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/) || [])[1] || (/^[\w-]{11}$/.test(u) ? u : null);
function seedItems(k) {
  const p = D.players[k], ss = p.ss || [], y0 = ss.length ? Math.min(...ss.map(r => r[0])) : p.st?.[0]?.[2], pk = p.mr?.pk || p.pk || null;
  const b = p.born ? +p.born.slice(0, 4) : (y0 || 1900) - 25, d = p.died ? +p.died.slice(0, 4) : 2026, yr = t => yearIn(t, b, d);
  const out = datedStories(p, y0).map((o, i) => ({ id: 's' + i, k: 'story', y: o.y, t: o.x[0], u: o.x[1], src: o.x[2] }));
  const season = /^(\d{4}) \(([^)]*)\):?\s*(.*)$/;  // season lines from the doc sit in the career table; without one they become paragraphs
  (NOTES.players[k] || []).forEach((x, i) => { const sm = x.match(season); if (sm && ss.length) return;
    out.push(sm ? { id: 'w' + i, k: 'text', y: +sm[1], t: sm[3] || '' } : { id: 'w' + i, k: 'text', y: yr(x), t: x }); });
  if (CARD.some(([c]) => p.tools?.[c] != null)) out.push({ id: 'card', k: 'card', y: pk });
  const v = (id, x, y) => x && out.push({ id, k: 'video', y, v: x[0], t: x[1], src: x[2] || '', min: x[3] || null });
  v('hl', p.md?.hl, yr(p.md?.hl?.[1]) ?? pk); v('iv', p.md?.iv, yr(p.md?.iv?.[1]));
  (p.md?.ph || []).forEach((x, i) => out.push({ id: 'ph' + i, k: 'photo', y: yr(decodeURIComponent(x[0].split('/').pop()).replace(/_/g, ' ')) ?? yr(x[4]) ?? pk, u: x[0], page: x[3], t: x[4] || '', credit: [x[1], x[2]].filter(Boolean).join(' · ') }));
  return out;
}
const itemsOf = k => pg('p_' + k)?.items || seedItems(k);
const sortItems = items => items.slice().sort((a, b) => (a.y ?? 1e9) - (b.y ?? 1e9));  // stable: same-year items keep their order
let TL_EDIT = null;  // the item whose form is open
const TL_KINDS = { story: 'Story', text: 'Paragraph', photo: 'Photo', video: 'Video', card: 'Scouting card' };
function itemBody(o, p) {
  if (o.k === 'story') return `<div class="clip story">${esc(o.t)}${o.u ? ` <a class="src" href="${esc(o.u)}" target="_blank" rel="noopener">${esc(o.src || 'Source')} ↗</a>` : ''}</div>`;
  if (o.k === 'text') return `<div class="writeup tl-text"><p>${md(o.t)}</p></div>`;
  if (o.k === 'photo') return `<figure class="tl-photo"><a href="${esc(o.page || o.u)}" target="_blank" rel="noopener"${o.credit ? ` title="Photo: ${esc(o.credit)}"` : ''}><img src="${esc(o.u)}" alt="${esc(o.t)}" loading="lazy"></a>${o.t ? `<figcaption>${esc(o.t)}</figcaption>` : ''}</figure>`;
  if (o.k === 'video') return ytEmbed([o.v, o.t, o.src, o.min]);
  if (o.k === 'card') return cardHTML(p);
  return '';
}
function tlItem(o, p, ed) {
  if (!ed) return itemBody(o, p);
  if (TL_EDIT === o.id) return `<div class="tl-item editing">${itemForm(o)}</div>`;
  return `<div class="tl-item">${itemBody(o, p) || '<p class="empty">Nothing to show.</p>'}<div class="tl-tools"><span class="tl-k">${TL_KINDS[o.k]} · ${o.y ?? 'after the career'}</span>
    <button type="button" data-tl="up:${esc(o.id)}" title="Move earlier">↑</button><button type="button" data-tl="down:${esc(o.id)}" title="Move later">↓</button>
    <button type="button" data-tl="edit:${esc(o.id)}">Edit</button><button type="button" data-tl="del:${esc(o.id)}" title="Remove">×</button></div></div>`;
}
function itemForm(o, isNew = false) {
  const inp = (n, ph, v) => `<input class="t" name="${n}" placeholder="${esc(ph)}" value="${esc(v ?? '')}"${isNew ? ` id="tl-${n}"` : ''}>`;
  const k = o.k, link = { story: 'Source link', photo: 'Image link', video: 'YouTube link' }[k];
  const linkV = k === 'video' && o.v ? 'https://www.youtube.com/watch?v=' + o.v : o.u;
  return `<form class="add tlform" data-id="${isNew ? 'new' : esc(o.id)}">
    ${isNew ? `<select class="t" name="k" id="tl-k" style="flex:0 0 auto">${Object.entries(TL_KINDS).filter(([x]) => x !== 'card').map(([x, l]) => `<option value="${x}">${l}</option>`).join('')}</select>` : `<div class="kind">${TL_KINDS[k]}</div>`}
    ${k !== 'card' || isNew ? `<textarea class="t" name="t" placeholder="${isNew ? 'The story, the paragraph, or a caption' : k === 'photo' || k === 'video' ? 'Caption' : ''}"${isNew ? ' id="tl-t"' : ''}>${esc(o.t || '')}</textarea>` : ''}
    <div class="r">${isNew ? inp('u', 'Link: the source, the image or the YouTube video') : link ? inp('u', link, linkV) : ''}${isNew || k === 'story' ? inp('src', 'Source name', o.src) : ''}
    <input class="t" name="y" placeholder="Year" inputmode="numeric" style="flex:0 0 80px" value="${esc(o.y ?? '')}"${isNew ? ' id="tl-y"' : ''}>
    <button class="btn" type="submit">${isNew ? 'Add' : 'Save'}</button>${isNew ? '' : '<button class="btn ghost" type="button" data-tl="cancel:">Cancel</button>'}</div></form>`;
}
// edit a player's timeline: the first edit copies the draft in
function editItems(key, fn) { mutate(key, cur => { cur.items = fn(sortItems(cur.items || seedItems(key.slice(2)))) || cur.items; }); }
function timelineAct(key, act, id) {
  if (act === 'edit' || act === 'cancel') { TL_EDIT = act === 'edit' ? id : null; return render(false); }
  if (act === 'del' && !confirm('Remove this from the timeline?')) return;
  editItems(key, L => {
    const i = L.findIndex(o => o.id === id); if (i < 0) return L;
    if (act === 'del') return L.filter(o => o.id !== id);
    const j = i + (act === 'up' ? -1 : 1); if (j < 0 || j >= L.length) return L;
    const a = L[i], b = L[j]; a.y = b.y; L[i] = b; L[j] = a;  // a step past a neighbor in another year moves it into that year
    return L;
  });
}
function timelineSave(key, f) {
  const val = n => (f.elements.namedItem(n)?.value || '').trim(), y = val('y'), isNew = f.dataset.id === 'new';
  const o = isNew ? { id: 'u' + Date.now().toString(36), k: val('k') } : structuredClone(itemsOf(key.slice(2)).find(x => x.id === f.dataset.id));
  if (!o) return;
  o.y = /^\d{4}$/.test(y) ? +y : null;
  if (o.k !== 'card') o.t = val('t');
  if (o.k === 'story') { o.u = val('u'); o.src = val('src') || (o.u ? new URL(o.u, location.href).hostname.replace(/^www\./, '') : ''); }
  if (o.k === 'photo' && val('u') !== o.u) Object.assign(o, { u: val('u'), page: val('u'), credit: '' });
  if (o.k === 'video') { const v = ytId(val('u')); if (!v) return setNote('That isn’t a YouTube link.'); if (v !== o.v) Object.assign(o, { v, src: '', min: null }); }
  if ((o.k === 'photo' && !o.u) || ((o.k === 'story' || o.k === 'text') && !o.t)) return setNote(o.k === 'photo' ? 'A photo needs an image link.' : 'Write something first.');
  setNote(''); TL_EDIT = null; if (isNew) f.reset();  // so the re-render doesn't carry the text back in
  editItems(key, L => isNew ? [...L, o] : L.map(x => x.id === o.id ? o : x));
}
// the biography: the timeline in order, with the career table in the middle, a row per season and team (rating and
// rank that year, gold in a year's top 5), that season's items under it, career totals at the bottom
function bioHTML(p, k, links, items, ed) {
  const pitcher = POSP.has(p.pos), rel = p.mr?.rel, ss = p.ss || [], bat = p.bat, pit = p.pit;
  const showBat = bat && (!pitcher || bat.AB > 1500), showPit = pit && (pitcher || parseFloat(pit.IP) > 300);
  const by = {}; for (const a of p.arc || []) if ((a[3] === 'R') === !!rel && (!by[a[0]] || a[1] > by[a[0]][1])) by[a[0]] = a;
  const by0 = p.born ? p.born.split('-').map(Number) : null, age = y => by0 ? y - by0[0] - ((by0[1] || 1) > 6 ? 1 : 0) : '';
  const m = p.mr, fmt = rel ? fmtS : fmtR;
  const h2 = `<h2>Biography <small class="find">${links.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)} ↗</a>`).join(' · ')}</small></h2>`;
  const head = m ? `<div class="sub" style="margin-top:0">${m.rel ? `<span><b>${fmtS(m.r)}</b> per-batter rating</span>` : `<span title="${RATING}"><b>${fmtR(m.r)}</b> ${tierOf(m.r)}</span>`}</div>` : '';
  const clubs = p.clubs && p.clubs.length ? `<h3 class="sm">Clubs</h3><div class="list">${p.clubs.map(c => c[4] ? `<button class="row" onclick="go('c_${c[4]}')"><span class="yr">${esc(c[1])}</span><span class="rn">${esc(c[0])}</span></button>` : `<div class="row" style="cursor:default"><span class="yr">${esc(c[1])}</span><span class="rn">${esc(c[0])}</span></div>`).join('')}</div>` : '';
  const sy = ss.map(r => r[0]), y0 = sy.length ? Math.min(...sy) : p.st?.[0]?.[2], y1 = sy.length ? Math.max(...sy) : p.st?.length ? Math.max(...p.st.map(x => x[3])) : y0;
  const st = sortItems(items), inRun = o => o.y != null && o.y >= y0 && o.y <= y1, one = o => tlItem(o, p, ed);
  const before = st.filter(o => o.y != null && o.y < y0), after = st.filter(o => o.y == null || o.y > y1);
  if (!ss.length || !(showBat || showPit)) return `${h2}${head}${clubs}${st.map(one).join('')}`;
  const primP = !showBat || (pitcher && showPit);
  const B = [['G', 0], ['PA', 1], ['R', 3], ['H', 4], ['2B', 5], ['3B', 6], ['HR', 7], ['RBI', 8], ['SB', 9], ['BB', 10], ['SO', 11], ['AVG', 12], ['OBP', 13], ['SLG', 14]];
  const Pc = [['W', 0], ['L', 1], ['ERA', 10], ['G', 2], ['GS', 3], ['SV', 4], ['IP', 5], ['H', 6], ['BB', 7], ['SO', 8], ['HR', 9]];
  const main = primP ? Pc : B, mi = primP ? 4 : 3, second = primP ? (showBat ? [['AVG', 12], ['OBP', 13], ['SLG', 14]] : []) : (showPit ? [['W–L', -1], ['IP', 5], ['ERA', 10]] : []), si = primP ? 3 : 4;
  const cell = (line, c) => !line ? '' : c[1] === -1 ? `${line[0]}–${line[1]}` : esc(line[c[1]]);
  const rk = a => !a || a[2] == null ? '' : `${a[2] <= 5 && !rel ? `<span class="t5" title="Top 5 that year">#${a[2]}</span>` : '#' + a[2]}${a[3] === 'P' && !primP ? ' P' : ''}`;
  const reads = seasonReads(k), ncol = 5 + main.length + second.length, byY = {};
  for (const o of st.filter(inRun)) (byY[o.y] = byY[o.y] || []).push(o);
  const yrs = [...new Set([...sy, ...Object.keys(reads).map(Number), ...Object.keys(byY).map(Number)])].sort((a, b) => a - b);
  const readRow = y => reads[y] && reads[y][0] ? `<tr class="read"><td></td><td colspan="${ncol - 1}">${md(reads[y][0])}</td></tr>` : '';
  const storyRows = y => (byY[y] || []).map(o => `<tr class="story"><td colspan="${ncol}">${one(o)}</td></tr>`).join('');
  const rows = yrs.map(y => { const rs = ss.filter(r => r[0] === y), a = by[y];
    if (!rs.length) return `<tr class="nostat"><td><a href="#" onclick="go('y_${y}');return false">${y}</a></td><td>${age(y)}</td><td colspan="${ncol - 2}">${esc(reads[y]?.[1] || '')}</td></tr>${readRow(y)}${storyRows(y)}`;
    return rs.map((r, i) => `<tr><td>${i ? '' : `<a href="#" onclick="go('y_${y}');return false">${y}</a>`}</td><td>${i ? '' : age(y)}</td><td>${r[1] ? `<a href="#" onclick="go('t_${r[1]}');return false">${esc(r[2])}</a>` : r[5] ? `<a href="#" onclick="go('c_${r[5]}');return false">${esc(r[2])}</a>` : esc(r[2])}</td><td class="mdl">${!i && a ? fmt(a[1]) : ''}</td><td class="mdl">${i ? '' : rk(a)}</td>${main.map(c => `<td>${cell(r[mi], c)}</td>`).join('')}${second.map(c => `<td class="sec">${cell(r[si], c)}</td>`).join('')}</tr>`).join('') + readRow(y) + storyRows(y); }).join('');
  const sum = (idx, i) => ss.reduce((t, r) => t + (r[idx] ? +r[idx][i] || 0 : 0), 0);
  const tot = c => primP ? ({ ERA: pit.ERA, IP: pit.IP }[c[0]] ?? sum(4, c[1])) : ({ AVG: bat.AVG, OBP: bat.OBP, SLG: bat.SLG }[c[0]] ?? sum(3, c[1]));
  const tot2 = c => c[1] === -1 ? `${pit.W}–${pit.L}` : primP ? bat[c[0]] : pit[c[0]];
  return `${h2}${head}${before.map(one).join('')}
   <div class="statline"><table class="stats career"><tr><th>Year</th><th>Age</th><th>Team</th><th class="mdl" title="${rel ? 'Per batter faced' : RATING}">Rating</th><th class="mdl">Rk</th>${main.map(c => `<th>${c[0]}</th>`).join('')}${second.map(c => `<th class="sec">${c[0]}</th>`).join('')}</tr>
   ${rows}<tr class="tot"><td>Career</td><td></td><td></td><td class="mdl">${m ? fmt(m.r) : ''}</td><td class="mdl">${m ? '#' + m.rk : ''}</td>${main.map(c => `<td>${tot(c)}</td>`).join('')}${second.map(c => `<td class="sec">${tot2(c)}</td>`).join('')}</tr></table></div>
   ${after.map(one).join('')}`;
}
const ytEmbed = v => v ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(v[0])}" title="${esc(v[1])}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
  <p class="note">${esc(v[1])}${v[2] ? ' · ' + esc(v[2]) : ''}${v[3] ? ' · ' + v[3] + ' min' : ''} · <a href="https://www.youtube.com/watch?v=${esc(v[0])}" target="_blank" rel="noopener">Watch on YouTube ↗</a></p>` : '';
// your doc's lines about a player that start with "YYYY (...)": year -> [what you wrote, the team/position bit]
function seasonReads(k) {
  const out = {}; for (const x of NOTES.players[k] || []) { const m = x.match(/^(\d{4}) \(([^)]*)\):?\s*(.*)$/); if (m) out[m[1]] = [m[3] || '', m[2]]; }
  return out;
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
   ${t.tr ? `<h2>By the model <small>talent and results</small></h2><div class="sub" style="margin-top:0"><span><b>${fmtS(t.tr.a)}</b> wins over an average team</span><span><b>#${t.tr.yr}</b> of ${t.tr.n} in ${t.y}</span><span><b>#${t.tr.ar}</b> all-time</span></div>
   <p class="note">Per 162 games: talent ${fmtS(t.tr.tal)} (80%), Pythagorean record ${fmtS(t.tr.py)} (15%), actual record ${fmtS(t.tr.wp)} (5%)${t.w + t.l < 150 ? ', records shrunk toward .500 for the short season' : ''}.</p>
   <p class="note">${t.tr.v} projected WAR per 162: ${t.tr.h} from position players, ${t.tr.p} from pitchers. Most of it from ${t.tr.top.map(e => `${e[1] ? `<a href="#" onclick="go('p_${e[1]}');return false">${esc(e[0])}</a>` : esc(e[0])}${e[2] != null ? ` (<span title="${RATING}">${fmtR(e[2])}</span>)` : ''}`).join(', ')}.</p>` : ''}
   ${park || t.park ? `<h2>Ballpark</h2><div class="parkbox"><b>${esc(park ? park.n : t.park)}</b>${park ? ` · ${esc(park.c)} · used ${park.y0}–${park.y1}${park.al ? `<div class="note">Also called ${esc(park.al)}</div>` : ''}${park.note ? `<div class="note">Note: ${esc(park.note)}</div>` : ''}` : (t.ap ? ' <span class="note">(map pin at the city)</span>' : '')}</div>` : ''}
   <h2>From the list <small>${ro.length} on this roster${t.ros ? ', best rating first' : ''}</small></h2>${ro.length ? `<div class="chips">${ro.map(k => t.ros && k in t.ros ? playerChip(k).replace('</button>', ` <span class="k" title="${RATING}">${fmtR(t.ros[k])}</span></button>`) : playerChip(k)).join('')}</div>` : '<p class="empty">Nobody from the list played here this year.</p>'}
   ${rosterHTML(tid)}
   ${gms.length ? `<h2>Great games</h2><div class="list">${gms.map(gameRow).join('')}</div>` : ''}
   <h2>The franchise <small>${fr ? `<a href="#" onclick="go('f_${t.fr}');return false">${esc(fr.n)} ›</a>` : esc(t.n)}</small></h2>
   <div class="list">${eras.map(e => `<button class="row" onclick="go('t_${e.tid}')"><span class="yr">${e.y0}${e.y1 !== e.y0 ? '–' + e.y1 : ''}</span><span class="rn">${esc(e.n)}${e.c ? `<small>${esc(e.c)}</small>` : ''}</span></button>`).join('')}</div>`;
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
   <h2>Names and homes</h2><div class="list">${eras.map(e => `<button class="row" onclick="go('t_${e.tid}')"><span class="yr">${e.y0}${e.y1 !== e.y0 ? '–' + e.y1 : ''}</span><span class="rn">${esc(e.n)}${e.c ? `<small>${esc(e.c)}</small>` : ''}</span></button>`).join('')}</div>
   ${(fr.pk || []).length ? `<h2>Ballparks <small>photos and diagrams from Wikipedia; hover for credits</small></h2><div class="parks">${fr.pk.map(parkCard).join('')}</div>` : ''}
   ${rated.length ? `<h2>Best seasons <small>by the model</small></h2><div class="list">${rated.slice(0, 8).map(teamRankRow).join('')}</div>` : ''}
   ${mine.length ? `<h2>From the list <small>${mine.length} played here</small></h2><div class="chips">${mine.map(playerChip).join('')}</div>` : ''}
   ${managersHTML(fr.mg)}
   ${fr.ex ? `<h2>Front office <small>from Wikipedia</small></h2><div class="execs">${[['own', 'Principal owners'], ['gm', 'General managers']].filter(([k]) => fr.ex[k]).map(([k, l]) => `<div><h3 class="sm">${l}</h3>${execRows(fr.ex[k])}</div>`).join('')}</div>` : ''}
   <h2>Every season</h2><div class="statline"><table class="stats roster fr"><tr><th>Year</th><th class="nm">Team</th><th>W–L</th><th>Finish</th><th></th><th title="The model, wins over an average team">Score</th><th>Rank</th><th title="Best team that season (tracked)">★</th></tr>${ts.map(season).join('')}</table></div>`;
}
// a home park: Wikipedia photo, its dimensions diagram (or a field drawn from the infobox distances), years here
const wpFile = f => 'https://en.wikipedia.org/wiki/File:' + enc(f);
const credit = x => `${x.credit}${x.license ? ' · ' + x.license : ''} · ${x.source}`;
const DIM_ABBR = [[/left.*cent/i, 'LC'], [/right.*cent/i, 'RC'], [/cent/i, 'CF'], [/left/i, 'LF'], [/right/i, 'RF'], [/backstop|home/i, 'BS']];
const dimAbbr = l => (DIM_ABBR.find(([re]) => re.test(l)) || [, l])[1];
function parkCard([pk, spans]) {
  const p = D.parks[pk], m = PARKS[pk] || {}; if (!p) return '';
  const yrs = spans.map(([a, b]) => a === b ? a : `${a}–${b}`).join(', ');
  const wp = m.page ? 'https://en.wikipedia.org/wiki/' + enc(m.page.replace(/ /g, '_')) : wiki(`${p.n} ${p.c} ballpark`);
  const photo = m.photo ? `<a class="pph" href="${wpFile(m.photo.source)}" target="_blank" rel="noopener" title="Photo: ${esc(credit(m.photo))}"><img src="parks/${esc(m.photo.file)}" alt="${esc(p.n)}" loading="lazy"></a>` : '';
  const dim = m.diagram ? `<a class="pdim" href="${wpFile(m.diagram.source)}" target="_blank" rel="noopener" title="Diagram: ${esc(credit(m.diagram))}"><img src="parks/${esc(m.diagram.file)}" alt="${esc(p.n)} dimensions" loading="lazy"></a>`
    : m.dims ? fieldSVG(m.dims) : '';
  const dims = (m.dims || []).filter(([l]) => dimAbbr(l) !== 'BS');
  return `<div class="park">${photo || dim ? `<div class="pimgs${photo && dim ? '' : ' one'}">${photo}${dim}</div>` : ''}
   <div class="pinfo"><b>${esc(p.n)}</b> · ${esc(p.c)}${p.st && !/^x/.test(pk) ? ', ' + esc(p.st) : ''} · ${yrs}
   ${dims.length ? `<div class="note">${dims.map(([l, ft]) => `<span title="${esc(l)}">${dimAbbr(l)} ${ft}</span>`).join(' · ')}</div>` : ''}
   ${p.al ? `<div class="note">Also called ${esc(p.al)}</div>` : ''}${p.note ? `<div class="note">Note: ${esc(p.note)}</div>` : ''}
   <div class="note"><a href="${esc(wp)}" target="_blank" rel="noopener">Wikipedia ↗</a></div></div></div>`;
}
// no diagram on Wikipedia: draw the field from the infobox distances (feet), home plate at the bottom
function fieldSVG(dims) {
  const ANG = { LF: -45, LC: -22.5, CF: 0, RC: 22.5, RF: 45 }, seen = {};
  const pts = dims.map(([l, ft]) => { const a = dimAbbr(l); if (!(a in ANG)) return null; const n = seen[a] = (seen[a] || 0) + 1;
    const deg = a === 'LF' || a === 'RF' ? ANG[a] : ANG[a] + (n - 1) * 6; return { deg, ft, r: deg * Math.PI / 180 }; })
    .filter(Boolean).sort((a, b) => a.deg - b.deg);
  if (pts.length < 3 || pts[0].deg !== -45 || pts[pts.length - 1].deg !== 45) return '';
  const xy = (r, ft) => [ft * Math.sin(r), -ft * Math.cos(r)], P = pts.map(p => xy(p.r, p.ft));
  let d = `M0,0L${P[0]}`;  // Catmull-Rom through the wall points
  for (let i = 0; i < P.length - 1; i++) { const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
    d += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2}`; }
  const xs = P.map(p => p[0]), top = Math.min(...P.map(p => p[1])) - 50, b = 90 / Math.SQRT2;
  const x0 = Math.min(...xs) - 50, x1 = Math.max(...xs) + 50;
  return `<svg class="pdim field" viewBox="${x0} ${top} ${x1 - x0} ${20 - top}" role="img" aria-label="Field dimensions"><path class="g" d="${d}Z"/>
   <path class="dirt" d="M0,0L${-b},${-b}L0,${-2 * b}L${b},${-b}Z"/><path class="ln" d="M0,0L${P[0]}M0,0L${P[P.length - 1]}"/>
   ${pts.map(p => { const [x, y] = xy(p.r, p.ft + 22); return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${p.ft}</text>`; }).join('')}</svg>`;
}
// a name in a box score: your list's players open their pages, others Baseball-Reference ([key, bbref id])
const whoLink = (n, [k, br] = []) => k ? `<a class="in" href="#" onclick="go('p_${k}');return false">${esc(n)}</a>`
  : br ? `<a class="ext" href="https://www.baseball-reference.com/players/${esc(br[0])}/${esc(br)}.shtml" target="_blank" rel="noopener" title="Baseball-Reference">${esc(n)}</a>` : esc(n);
function managersHTML(mg) {
  if (!mg || !mg.length) return '';
  const row = ([n, k, br, y0, y1, w, l]) => `<tr><td>${y0}${y1 !== y0 ? '–' + y1 : ''}</td><td class="nm">${k ? `<a href="#" onclick="go('p_${k}');return false">${esc(n)}</a>`
    : br ? `<a href="https://www.baseball-reference.com/managers/${esc(br)}.shtml" target="_blank" rel="noopener">${esc(n)}</a>` : esc(n)}</td><td>${w}–${l}</td><td>${w + l ? (w / (w + l)).toFixed(3).replace(/^0/, '') : ''}</td></tr>`;
  return `<h2>Managers <small>${mg.length} stints; listed players open their pages, others Baseball-Reference</small></h2>
   <div class="statline"><table class="stats roster fr"><tr><th>Years</th><th class="nm">Manager</th><th>W–L</th><th>Pct</th></tr>${mg.map(row).join('')}</table></div>`;
}
// owners or general managers, grouped by the franchise's eras: [group, parts (text or [name, article]), years]
function execRows(rows) {
  let g = null;
  return rows.map(([grp, parts, yrs]) => `${grp !== g && (g = grp) ? `<div class="exg">${esc(grp)}</div>` : ''}<div class="exr"><span class="yr">${esc(yrs)}</span><span>${parts.map(x => Array.isArray(x)
    ? `<a href="https://en.wikipedia.org/wiki/${enc(x[1].replace(/ /g, '_'))}" target="_blank" rel="noopener">${esc(x[0])}</a>` : esc(x)).join('')}</span></div>`).join('');
}
function vClub() {  // clubs outside the database (NPB, Cuba, Mexico, Puerto Rico...): who of yours played there
  const k = view.id, c = D.clubs[k]; if (!c) return notFound(); const key = 'c_' + k;
  const pl = c.pl.filter(x => D.players[x[0]]).sort((a, b) => (a[1] || 9999) - (b[1] || 9999));
  return `${crumbs('Club', key)}${banner()}<div class="eyebrow">${esc([c.c, c.cn].filter(Boolean).join(', '))}</div><h1 class="name">${esc(c.n)}</h1>
   <h2>From the list <small>${pl.length} played here</small></h2><div class="list">${pl.map(([pk, y0, y1]) => { const p = D.players[pk];
     return `<button class="row" onclick="go('p_${pk}')">${avatar(pk)}<span class="yr">${y0 ? y0 + (y1 !== y0 ? '–' + y1 : '') : ''}</span><span class="rn">${esc(nameOf(p))}<small>${esc(p.pos)}</small></span></button>`; }).join('')}</div>
   ${section('The club', [['Wikipedia', wiki(c.n + ' baseball')], ['Photos', img(c.n + ' baseball')]])}`;
}
const ip = o => o == null ? '' : Math.floor(o / 3) + (o % 3 ? '.' + (o % 3) : '');
const nv = v => v == null ? '' : v;
// one team's box score: batters (subs indented under the man they replaced), extra-base hits and steals, pitchers
function teamBox(s) {
  const sum = i => s.bat.some(b => b[i] == null) ? '' : s.bat.reduce((t, b) => t + b[i], 0), who = b => whoLink(b[0], b.slice(13));
  const bat = `<table class="stats box"><tr><th class="nm">Batting</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>SO</th></tr>
    ${s.bat.map(b => `<tr${b[12] ? ' class="subst"' : ''}><td class="nm">${who(b)} <span class="pos">${esc(b[1])}</span></td>${[2, 3, 4, 5, 6, 7].map(i => `<td>${nv(b[i])}</td>`).join('')}</tr>`).join('')}
    <tr class="tot"><td class="nm">Totals</td>${[2, 3, 4, 5, 6, 7].map(i => `<td>${sum(i)}</td>`).join('')}</tr></table>`;
  const xb = [[8, '2B'], [9, '3B'], [10, 'HR'], [11, 'SB']].map(([i, l]) => { const hs = s.bat.filter(b => b[i] > 0);
    return hs.length ? `<span><b>${l}:</b> ${hs.map(b => esc(b[0].split(' ').slice(-1)[0]) + (b[i] > 1 ? ' ' + b[i] : '')).join(', ')}</span>` : ''; }).join('');
  const pit = s.pit && s.pit.length ? `<table class="stats box"><tr><th class="nm">Pitching</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>SO</th><th>HR</th></tr>
    ${s.pit.map(p => `<tr><td class="nm">${whoLink(p[0], p.slice(9))}${p[8] ? ` <span class="pos">${p[8]}</span>` : ''}</td><td>${ip(p[1])}</td>${[2, 3, 4, 5, 6, 7].map(i => `<td>${nv(p[i])}</td>`).join('')}</tr>`).join('')}</table>` : '';
  return `<h3 class="sm">${esc(s.fn || s.n)}</h3><div class="statline">${bat}</div>${xb ? `<p class="sub boxnotes">${xb}</p>` : ''}<div class="statline">${pit}</div>`;
}
// the Wikipedia write-up of the game, linked to its section
const gameStory = st => st && st.p ? `<div class="clip story">${st.p.map(x => `<p>${esc(x)}</p>`).join('')}<a class="src" href="${esc(st.url)}" target="_blank" rel="noopener">${esc(st.src)}, Wikipedia ↗</a></div>` : '';
function vGame() {
  const g = D.games[view.id]; if (!g) return notFound(); const key = 'g_' + g.rk, n = `${g.y} ${g.gt || g.g}`;
  if (!BOXES) boxLoad = boxLoad || getJSON('data/games.json', {}).then(b => { BOXES = b; if (view.type === 'g') render(false); });
  const rec = BOXES && BOXES[view.id], bx = rec && rec.v ? rec : null;
  const team = (s, full) => {
    const t = D.teams[s.tid], target = t ? (s.tid === g.tid ? 't_' + s.tid : 'f_' + t.fr) : null;
    return target ? `<a class="in" href="#${target.replace('_', '-')}" onclick="go('${target}');return false">${esc(full ? s.fn || s.n : s.n)}</a>` : esc(full ? s.fn || s.n : s.n);
  };
  // the result, winner first: "Houston Astros 13, Los Angeles Dodgers 12 (10)"
  const score = bx ? (() => { const inn = Math.max(bx.v.inn.length, bx.h.inn.length), [w, l] = bx.h.r > bx.v.r ? [bx.h, bx.v] : [bx.v, bx.h];
    return `<p class="score">${team(w, true)} ${w.r}, ${team(l, true)} ${l.r}${inn && inn !== 9 ? ` <span class="inn">(${inn})</span>` : ''}</p>`; })() : '';
  const ser = bx && bx.ser ? `<div class="sub" style="margin-top:4px"><span><b>${esc(bx.ser[0])}</b></span><span>Best of ${bx.ser[1]}</span></div>` : '';
  const line = bx ? (() => { const k = Math.max(9, bx.v.inn.length, bx.h.inn.length), cells = a => [...Array(k)].map((_, i) => `<td>${esc(a[i] ?? '')}</td>`).join('');
    return `<div class="statline"><table class="stats linescore"><tr><th></th>${[...Array(k)].map((_, i) => `<th>${i + 1}</th>`).join('')}<th class="rhe">R</th><th>H</th><th>E</th></tr>
      ${[bx.v, bx.h].map(s => `<tr><td class="nm">${team(s)}</td>${cells(s.inn)}<td class="rhe"><b>${s.r}</b></td><td>${s.h}</td><td>${s.e}</td></tr>`).join('')}</table></div>
      <div class="sub" style="margin-top:6px">${[['W', bx.wp, bx.wpl], ['L', bx.lp, bx.lpl], ['S', bx.sv, bx.svl]].filter(x => x[1]).map(([l, n, w]) => `<span>${l}: <b>${whoLink(n, w)}</b></span>`).join('')}</div>
      <p class="note">${esc(bx.date)} · ${esc(bx.park)}${bx.att ? ` · ${bx.att.toLocaleString()} fans` : ''}${bx.time ? ` · ${Math.floor(bx.time / 60)}:${String(bx.time % 60).padStart(2, '0')}` : ''}</p>`; })() : '';
  const full = bx && bx.v.bat && bx.v.bat.length;
  const lineups = bx && !full && (bx.v.lu.length || bx.h.lu.length) ? `<div class="lineups">${[bx.v, bx.h].map(s => `<div><h3 class="sm">${esc(s.n)}</h3><table class="stats roster">${s.lu.map((p, i) => `<tr><td>${i + 1}</td><td class="nm">${whoLink(p[0], p.slice(2))}</td><td>${esc(p[1])}</td></tr>`).join('')}</table></div>`).join('')}</div>` : '';
  const wikiQ = wiki(n);
  return `${crumbs('Game', key)}${banner()}<div class="eyebrow">${g.o ? 'From the “Others” row' : `#${g.rk}`}</div>
   <h1 class="name">${esc(n)}</h1>${score}${ser}
   ${!bx && g.tid ? `<div class="sub" style="margin-top:8px"><span><a class="in" href="#" onclick="go('t_${g.tid}');return false">${esc(D.teams[g.tid].y + ' ' + D.teams[g.tid].n)}</a></span></div>` : ''}
   <h2>Line score</h2>${line || (BOXES ? '<p class="empty">No line score for this one in Retrosheet’s game logs.</p>' : '<p class="note">Loading…</p>')}
   ${bx ? `<h2>Box score${bx.br ? ` <small class="find"><a href="${esc(bx.br)}" target="_blank" rel="noopener">Baseball-Reference ↗</a></small>` : ''}</h2>
     ${full ? `<p class="note linkkey"><a class="in" href="#" onclick="return false">Names like this</a> open their pages here; <a class="ext" href="#" onclick="return false">names like this</a> go to Baseball-Reference.</p>${teamBox(bx.v)}${teamBox(bx.h)}` : lineups}` : ''}
   <h2>Video <small class="find"><a href="${esc(yt(n + ' ' + (g.vs || '') + ' full game'))}" target="_blank" rel="noopener">YouTube search ↗</a></small></h2>${ytEmbed(g.yt)}
   ${section('Game story', [['Wikipedia', rec?.sto?.url || wikiQ]], gameStory(rec?.sto))}`;
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
  const sortSel = yearLabel => `<select class="t" id="rksort" style="flex:0 0 auto"><option value="rank" ${st.sort === 'rank' ? 'selected' : ''}>List order</option><option value="peak" ${st.sort === 'peak' ? 'selected' : ''}>${yearLabel}</option>${editing() ? `<option value="lit" ${st.sort === 'lit' ? 'selected' : ''}>Drafts first</option>` : ''}</select>`;
  if (h === 'players') {
    const arr = Object.entries(D.players).filter(([, p]) => (st.pos === 'All' || p.pos === st.pos) && (!f || nameOf(p).toLowerCase().includes(f)));
    const byRank = (a, b) => st.pos === 'All' ? (a[1].ovr || 999) - (b[1].ovr || 999) : (typeof a[1].prk === 'number' ? a[1].prk : 999) - (typeof b[1].prk === 'number' ? b[1].prk : 999);
    arr.sort({ rank: byRank, peak: (a, b) => (a[1].pk || 0) - (b[1].pk || 0), lit: (a, b) => litN('p_' + a[0]) - litN('p_' + b[0]) || byRank(a, b) }[st.sort] || byRank);
    const rows = arr.map(([k, p]) => { const fr = fromOf(k); const rk = st.pos === 'All' ? rankLabel(p) : (typeof p.prk === 'number' ? '#' + p.prk : p.prk || '') + ' ' + p.pos;
      return `<button class="row" onclick="go('p_${k}')">${avatar(k)}<span class="yr">${esc(rk)}</span><span class="rn">${esc(nameOf(p))}<small>peak ${p.pk || '?'}${fr ? ' · ' + esc(placeText(fr)) : ''}</small></span></button>`; }).join('');
    return `${banner()}<div class="eyebrow">The list · ${Object.keys(D.players).length} players</div><h1 class="name">Players</h1>
     <div class="chips" style="margin-bottom:8px">${['All', ...POSITIONS].map(p => `<button class="chip" aria-pressed="${st.pos === p}" data-pos="${p}">${p}</button>`).join('')}</div>
     ${filter('Filter by name…', sortSel('Peak year'))}<div class="list">${rows || '<p class="empty">No one matches.</p>'}</div>`;
  }
  if (h === 'games') {
    const arr = Object.values(D.games).filter(g => !f || (g.y + ' ' + g.g + ' ' + (g.gt || '') + ' ' + g.d).toLowerCase().includes(f));
    arr.sort((a, b) => st.sort === 'lit' ? litN('g_' + a.rk) - litN('g_' + b.rk) || a.rk - b.rk : st.sort === 'peak' ? a.y - b.y : a.rk - b.rk);
    return `${banner()}<div class="eyebrow">The list · ${Object.keys(D.games).length} games</div><h1 class="name">Games</h1>
     ${filter('Filter by year, series, description…', sortSel('Year'))}<div class="list">${arr.map(gameRow).join('') || '<p class="empty">No games match.</p>'}</div>`;
  }
  // teams: team seasons ranked by your model, or franchises with their name eras
  const rated = Object.entries(D.teams).filter(([, t]) => t.tr), ranked = rated.length && st.mode === 'rank';
  const modes = rated.length ? `<div class="chips" style="margin:8px 0">${[['rank', 'Ranked seasons'], ['franch', 'Franchises']].map(([m, l]) => `<button class="chip" aria-pressed="${st.mode === m}" data-tmode="${m}">${l}</button>`).join('')}</div>` : '';
  const grpChips = `<div class="chips" style="margin:8px 0">${[['all', 'All'], ...GROUPS].map(([g, l]) => `<button class="chip" aria-pressed="${st.grp === g}" data-grp="${g}">${g === 'all' ? 'All' : l}</button>`).join('')}</div>`;
  if (ranked) {
    const arr = rated.filter(([, t]) => (st.grp === 'all' || (LGROUP[t.lg] || 'ind') === st.grp) && (!f || (t.y + ' ' + t.n).toLowerCase().includes(f))).sort((a, b) => a[1].tr.ar - b[1].tr.ar);
    return `${banner()}<div class="eyebrow">The model · ${rated.length} team seasons</div><h1 class="name">Teams</h1>
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
    return `<h2>${label} <small>${xs.length}</small></h2><div class="list">${xs.map(x => `<div class="row frow">${badgeSm(x.last)}<span class="yr">${x.ts[0].y}–${x.last.y}</span><span class="rn"><a href="#" onclick="go('f_${x.fid}');return false">${esc(x.last.n)}</a><small>${x.eras.length > 1 ? x.eras.map(e => `<a href="#" onclick="go('t_${e.tid}');return false">${esc(e.n)}</a> ${e.y0}${e.y1 !== e.y0 ? '–' + e.y1 : ''}`).join(' · ') : `${x.ts.length} season${x.ts.length > 1 ? 's' : ''}`}</small></span>${editing() ? `<span class="meta" title="seasons locked">${x.fr.s.filter(tid => litN('t_' + tid)).length}/${x.ts.length}</span>` : ''}</div>`).join('')}</div>`;
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
  const prow = (pk, extra) => { const p = D.players[pk]; return `<button class="row" onclick="go('p_${pk}')">${avatar(pk)}<span class="yr">${esc(rankLabel(p))}</span><span class="rn">${esc(nameOf(p))}<small>${extra}</small></span></button>`; };
  const LIM = 25;
  return `${pagebar('l_' + k)}${banner()}<div class="placecrumbs">${trail.join('')}</div><div class="eyebrow">${['Country', 'State / region', 'City'][nd.lvl]}</div><h1 class="name">${esc(placeLabel(nd))}</h1>
   <div class="sub"><span><b>${nd.from.length}</b> of the players from here</span><span><b>${nd.played.size}</b> played here</span><span><b>${nd.teams.length}</b> team seasons</span>${nWS ? `<span><b>${nWS}</b> World Series</span>` : ''}${nPen ? `<span><b>${nPen}</b> pennants</span>` : ''}</div>
   <h2>Best players from here</h2>${from.length ? `<div class="list">${from.slice(0, LIM).map(pk => prow(pk, `peak ${D.players[pk].pk || '?'}${nd.lvl < 2 ? ' · ' + esc(fromOf(pk).c || '') : ''}`)).join('')}</div>${from.length > LIM ? `<p class="note">and ${from.length - LIM} more</p>` : ''}` : '<p class="empty">Nobody on the list is from here.</p>'}
   <h2>Best players to play here</h2>${played.length ? `<div class="list">${played.slice(0, LIM).map(([pk, x]) => prow(pk, `${x.y0}${x.y1 !== x.y0 ? '–' + x.y1 : ''} · ${esc([...x.tm].join(', '))}`)).join('')}</div>${played.length > LIM ? `<p class="note">and ${played.length - LIM} more</p>` : ''}` : '<p class="empty">No one from the list played for a team based here.</p>'}
   <h2>Best teams from here <small>by record</small></h2>${teams.length ? `<div class="list">${teams.slice(0, 20).map(([tid, t]) => `<button class="row" onclick="go('t_${tid}')"><span class="yr">${t.y} ${esc(t.lg)}</span><span class="rn">${esc(t.n)}<small>${t.w}–${t.l}${t.ws ? ' · won the World Series' : t.pen ? ' · pennant' : ''}</small></span></button>`).join('')}</div>` : '<p class="empty">No teams based here in the database.</p>'}
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
  $('#maphint').textContent = { teams: highlight ? `Every team on the field in ${YEAR}` : `Every team on the field in ${YEAR}. Click a badge.`, players: 'Where the players are from', places: 'Cities sized by how many of the players come from them' }[MAPMODE];
  return fit;
}
function render(newView = true, opts = {}) {
  const panel = $('#panel'), t = view.type, st = panel.scrollTop, active = document.activeElement && document.activeElement.id;
  const drafts = {}; for (const id of ['tl-k', 'tl-t', 'tl-u', 'tl-src', 'tl-y', 'rkfilter']) { const el = document.getElementById(id); if (el) drafts[id] = el.value; }
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
  // the timeline (only drawn while editing an unlocked page)
  document.querySelectorAll('[data-tl]').forEach(b => b.addEventListener('click', () => { const [act, id] = b.dataset.tl.split(':'); timelineAct(key, act, id); }));
  document.querySelectorAll('form.tlform').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); timelineSave(key, f); }));
  // home lists
  const st = view.type === 'r' ? RK[view.id] : null;
  document.querySelectorAll('[data-pos]').forEach(b => b.addEventListener('click', () => { st.pos = b.dataset.pos; render(false); }));
  document.querySelectorAll('[data-grp]').forEach(b => b.addEventListener('click', () => { st.grp = b.dataset.grp; st.n = 100; render(false); }));
  document.querySelectorAll('[data-tmode]').forEach(b => b.addEventListener('click', () => { st.mode = b.dataset.tmode; render(false); }));
  $('#tmore')?.addEventListener('click', () => { st.n += 200; render(false); });
  $('#rksort')?.addEventListener('change', e => { st.sort = e.target.value; render(false); });
  $('#rkfilter')?.addEventListener('input', e => { st.f = e.target.value; clearTimeout(window.__rf); window.__rf = setTimeout(() => render(false), 150); });
  // lock a page (or unlock it); a player page locks with its own copy of the timeline
  document.querySelectorAll('[data-lock]').forEach(b => b.addEventListener('click', () => { TL_EDIT = null;
    mutate(b.dataset.lock, cur => { if (cur.locked) delete cur.locked; else { if (b.dataset.lock.startsWith('p_') && !cur.items) cur.items = seedItems(b.dataset.lock.slice(2)); cur.locked = Date.now(); } }); scheduleSync(0); }));  // locking saves at once
  document.querySelectorAll('[data-spin]').forEach(b => b.addEventListener('click', () => spin(TRACK_TYPES[+b.dataset.spin])));
  wireSave();
}
function wireSave() {  // turning editing on and off
  $('#ghform')?.addEventListener('submit', async e => { e.preventDefault(); const t = $('#ghtoken').value.trim(); if (!t) return;
    $('#savemsg').textContent = 'Checking the token…';
    try { await ghConnect(t); render(false); } catch (err) { $('#savemsg').textContent = err.message; } });
  $('#ghsave')?.addEventListener('click', () => ghSave());
  $('#ghoff')?.addEventListener('click', () => { lsSet(GHK, null); clearTimeout(syncT); SYNC.state = 'idle'; syncUI(); editUI(); render(false); });
}
function spin(keys) {  // a random page; while editing, one not yet locked (of one kind, from the tracker)
  const pool = [...(keys || trackKeys().all)].filter(k => !editing() || !isLocked(k));
  if (!pool.length) { setNote('Every one of those is locked.'); return; }
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
  [D, WORLD, STATES, PHOTOS, PARKS] = await Promise.all([getJSON('data/atlas.json'), getJSON('data/world.json'), getJSON('data/states.json'), getJSON('data/photos.json', {}), getJSON('data/parks.json', {})]);
  NOTES = { ...NOTES, ...(await getJSON('data/notes.json', {})) };
  const [published, fresh] = await Promise.all([getJSON('data/pages.json', {}), ghPull()]);
  loadStore(published, fresh);
  if (ghToken() && JSON.stringify(fresh.pages || {}) !== JSON.stringify(STORE.pages)) { for (const k in STORE.pages) if (JSON.stringify(STORE.pages[k]) !== JSON.stringify(fresh.pages?.[k])) dirty.add(k); scheduleSync(1000); }  // edits made here that never reached GitHub
  editUI();
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
  $('#spin').addEventListener('click', () => spin());
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
