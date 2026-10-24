"use strict";
/* Living Atlas of Baseball
   Data: data/atlas.json (built by scripts/build_data.py), data/photos.json (scripts/fetch_photos.py),
   data/progress.json (your exported check-offs, committed), plus whatever this browser has saved. */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const getJSON = (u, fallback) => fetch(u).then(r => r.ok ? r.json() : fallback).catch(() => fallback);

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
   Everything you do is kept in this browser. "Export" gives you a file; commit it as
   docs/data/progress.json and every device that opens the site starts from it. */
const LS = 'atlas-progress-v1';
const STORE = { progress: {}, pins: {} };
function loadStore(committed) {
  const merge = src => {
    for (const [k, v] of Object.entries(src.progress || {})) if (!STORE.progress[k] || (v.at || 0) >= (STORE.progress[k].at || 0)) STORE.progress[k] = v;
    for (const [k, v] of Object.entries(src.pins || {})) if (!STORE.pins[k] || (v.at || 0) >= (STORE.pins[k].at || 0)) STORE.pins[k] = v;
    for (const k of src.deletedPins || []) delete STORE.pins[k];
  };
  merge(committed || {});
  try { const local = JSON.parse(localStorage.getItem(LS) || 'null'); if (local) merge(local); } catch (e) { /* private mode */ }
}
let saveT = null, deletedPins = new Set();
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem(LS, JSON.stringify({ ...STORE, deletedPins: [...deletedPins], savedAt: Date.now() })); }
    catch (e) { setNote('This browser isn’t letting the atlas save. Use Export to keep a copy.'); }
  }, 250);
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
  if (t === 's' && STORE.pins[id]) return { type: 's', id, o: STORE.pins[id] };
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
  if (e.type === 's') {
    const n = `${o.title} ${o.year || ''}`.trim();
    return [
      { id: 'video', g: 'see', label: 'Film or audio', hint: 'YouTube', url: yt(n) },
      { id: 'photos', g: 'see', label: 'Photos', hint: 'images', url: img(n) },
      { id: 'read', g: 'read', label: 'Read about it', hint: 'search', url: gg(n + ' baseball') },
      { id: 'news', g: 'read', label: 'Old newspapers', hint: 'Chronicling America', url: loc(o.title) },
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
const litN = key => { const l = lights(key); return (l.see ? 1 : 0) + (l.read ? 1 : 0) + (l.nums ? 1 : 0); };

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
let YEAR = 1897, MAPMODE = 'teams', showPins = true, highlight = null, focusPts = null;

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
    if (showPins) for (const [id, p] of Object.entries(STORE.pins)) if (p.ll && Math.abs((p.year || YEAR) - YEAR) <= 10) {
      const [x, y] = XY(p.ll);
      gBase.append('circle').datum({ r: 5.5 }).attr('class', 'dot pin').attr('cx', x).attr('cy', y).attr('fill', litN('s_' + id) ? 'var(--lit)' : 'var(--stitch)')
        .attr('stroke', 'var(--water)').on('click', () => go('s_' + id)).append('title').text(p.title);
    }
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
   Four homes (map, teams, players, games) each remember where you left them; every other view is a page. */
let view = { type: 'y', id: '1897' }; const stack = [];
const HOMES = ['map', 'teams', 'players', 'games'];
const homeOf = v => 'yld'.includes(v.type) ? 'map' : v.type === 'r' ? v.id : null;
const layoutOf = v => 'yld'.includes(v.type) ? 'map' : v.type === 'r' ? 'list' : 'page';
let lastHome = 'map', lastMap = { type: 'y', id: '1897' }, mapT = null, FULL = false, sizedFor = '';
const homeScroll = {};
const setHash = () => { try { history.replaceState(null, '', '#' + view.type + '-' + view.id); } catch (e) { } };
const scroller = () => innerWidth <= 820 ? document.scrollingElement : $('#panel');
function leave() {  // remember the home we're leaving
  const h = homeOf(view); if (!h) return;
  if (h === 'map') { lastMap = view; mapT = d3.zoomTransform(svg.node()); } else homeScroll[h] = scroller().scrollTop;
}
function go(key, push = true) {
  stopPlay(); leave(); setFull(false, false);
  if (push) { stack.push(view); if (stack.length > 40) stack.shift(); }
  view = { type: key[0], id: key.slice(2) };
  setHash(); render(true);
  scroller().scrollTop = 0;
}
function goHome(h) {
  if (h === 'map') { go(lastMap.type + '_' + lastMap.id); return render(true, { restore: true }); }
  go('r_' + h);
  if (homeScroll[h]) scroller().scrollTop = homeScroll[h];
}
function back() { const v = stack.pop(); if (v) { leave(); setFull(false, false); view = v; setHash(); render(true); } }
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
function arcSVG(p) {
  const rel = p.mr?.rel, by = {};  // one bar per season: the reliever line for relievers, else his better role that year
  for (const a of p.arc || []) if ((a[3] === 'R') === !!rel && (!by[a[0]] || a[1] > by[a[0]][1])) by[a[0]] = a;
  const arc = Object.values(by).sort((a, b) => a[0] - b[0]);
  if (arc.length < 2) return '';
  const top5 = new Set((p.ranks || []).filter(r => r[1] !== 'WPA').map(r => r[0])), y0 = arc[0][0], y1 = arc[arc.length - 1][0], n = y1 - y0 + 1;
  const hi = Math.max(rel ? 2 : 8, ...arc.map(a => a[1])), lo = Math.min(rel ? -2 : -4, ...arc.map(a => a[1]));
  const W = 600, H = 150, pad = 18, bw = W / n, yz = s => pad + (hi - s) / (hi - lo) * (H - 2 * pad);
  const bars = arc.map(a => {
    const x = (a[0] - y0) * bw, top = Math.min(yz(a[1]), yz(0)), h = Math.max(1.5, Math.abs(yz(a[1]) - yz(0)));
    const tip = `${a[0]}: ${fmtS(a[1])} · #${a[2]} ${a[3] === 'R' ? 'reliever' : a[3] === 'P' ? 'pitcher' : 'hitter'} that year${top5.has(a[0]) ? ' · in your top 5' : ''}`;
    return `<g class="bar ${a[1] > 0 ? 'up' : ''} ${top5.has(a[0]) ? 'mine' : ''}" onclick="go('y_${a[0]}')"><title>${esc(tip)}</title>
      <rect class="hit" x="${x}" y="0" width="${bw}" height="${H}"></rect><rect x="${x + Math.min(2, bw * .15)}" y="${top}" width="${Math.max(1, bw - Math.min(4, bw * .3))}" height="${h}" rx="${Math.min(3, bw / 4)}"></rect></g>`;
  }).join('');
  const REF = rel ? [[0, 'comparison line']] : [[6.9, 'all-timer'], [0, 'borderline']];
  const lines = REF.filter(l => l[0] <= hi && l[0] >= lo)
    .map(l => `<line x1="0" x2="${W}" y1="${yz(l[0])}" y2="${yz(l[0])}" class="${l[0] ? 'ref' : 'zero'}"></line>`).join('');
  const labs = REF.filter(l => l[0] <= hi && l[0] >= lo && (l[0] === 0 || yz(0) - yz(l[0]) > 14)).map(l => `<span class="lab" style="top:${yz(l[0]) / H * 100}%">${l[1]}</span>`).join('');
  return `<figure class="arc"><div class="plot">${labs}<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Season ratings ${y0} to ${y1}">${lines}${bars}</svg></div>
    <figcaption><span>${y0}</span><span>Each season's rating · outlined = in your top 5 · tap a season for that year</span><span>${y1}</span></figcaption></figure>`;
}
function modelHTML(p) {
  const m = p.mr, t = p.tools;
  if (!m && !p.arc) return '';
  const best = (p.arc || []).reduce((b, a) => !b || a[1] > b[1] ? a : b, null);
  return `<h2>By your model <small>from Baseball Ratings</small></h2>
   ${m && m.rel ? `<div class="sub" style="margin-top:0"><span><b>${fmtS(m.r)}</b> per-batter rating</span><span><b>#${m.rk}</b> among relievers</span>${m.war != null ? `<span><b>${m.war}</b> career WAR</span>` : ''}${m.hof ? '<span>In the Hall</span>' : ''}</div>` : ''}
   ${m && !m.rel ? `<div class="sub" style="margin-top:0"><span><b>${fmtS(m.r)}</b> ${tierOf(m.r)}</span><span><b>#${m.rk}</b> overall</span><span><b>#${m.prk}</b> ${esc(m.pos)}</span>${m.war != null ? `<span><b>${m.war}</b> career WAR</span>` : ''}<span>${m.hof ? 'In the Hall' : `<b>${Math.round(m.odds * 100)}%</b> Hall case`}</span></div>
   ${p.ovr && !m.rel && Math.abs(p.ovr - m.rk) >= 10 ? `<p class="note">Your list has him #${p.ovr}; the model, #${m.rk}.</p>` : ''}` : ''}
   ${arcSVG(p)}
   ${best ? `<p class="note">Best season by the model: <a href="#" onclick="go('y_${best[0]}');return false">${best[0]}</a>, ${fmtS(best[1])} (#${best[2]} that year).</p>` : ''}
   ${t && Object.keys(t).length ? `<p class="note">Tool grades (20–80, against every regular season, averaged over his four best) are filled into the scouting card below.</p>` : ''}`;
}
function modelList(lst, mine) {
  return `<div class="list">${lst.map((e, i) => { const [nm, k, s, pos, tid] = e, inner = `<span class="yr">#${i + 1} ${esc(pos || '')}</span><span class="rn">${esc(nm)}${mine && mine.has(nm) ? ' <span class="badge gold">your top 5</span>' : ''}${tid && D.teams[tid] ? `<small>${esc(D.teams[tid].n)}</small>` : ''}</span><span class="meta">${fmtS(s)}</span>`;
    return k ? `<button class="row" onclick="go('p_${k}')">${inner}</button>` : tid ? `<button class="row" onclick="go('t_${tid}')">${inner}</button>` : `<div class="row" style="cursor:default">${inner}</div>`; }).join('')}</div>`;
}
function teamRankRow([tid, t], i, all = true) {
  const r = t.tr;
  return `<button class="row" onclick="go('t_${tid}')">${badgeSm(t)}<span class="yr">#${all ? r.ar : r.yr}</span><span class="rn">${t.y} ${esc(t.n)}<small>${t.w}–${t.l}${t.ws ? ' · won the World Series' : t.pen ? ' · pennant' : ''} · ${r.v} projected WAR${all ? ` · #${r.yr} of ${r.n} in ${t.y}` : ''}</small></span><span class="meta">${fmtS(r.a)}</span></button>`;
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
const crumbs = label => `<div class="crumbs">${stack.length ? `<button id="backbtn">← Back</button><span>·</span>` : ''}<span>${esc(label)}</span></div>`;
const banner = () => `<div class="banner" id="dbnote" ${note ? '' : 'hidden'}>${esc(note)}</div>`;
function gameRow(g) { return `<button class="row" onclick="go('g_${g.rk}')"><span class="yr">${g.y} ${esc(g.g)}</span><span class="rn">${esc(g.d || 'Untitled game')}${g.gr ? ' <span class="badge gold">great</span>' : ''}<small>#${g.rk} on your list</small></span><span class="meta">${dotsHTML('g_' + g.rk)}</span></button>`; }
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
function vDecade() {
  const d = view.id === 'pre' ? 'pre' : String(Math.floor(+view.id / 10) * 10), pre = d === 'pre';
  const y0 = pre ? 1845 : +d, y1 = pre ? 1870 : Math.min(+d + 9, 2026), dn = NOTES.decades[d] || {};
  const eras = D.eras.filter(e => e[0] <= y1 && e[1] >= y0);
  const prev = pre ? null : +d === 1870 ? 'pre' : String(+d - 10), next = pre ? '1870' : +d < 2020 ? String(+d + 10) : null;
  const years = []; for (let y = Math.max(y0, 1871); y <= y1 && !pre; y++) years.push(y);
  const yearRow = y => { const tms = Object.entries(D.teams).filter(([, t]) => t.y === y), ws = tms.find(([, t]) => t.ws), q = (NOTES.years[y] || {}).quick || [];
    return `<div class="yrow"><button class="yhead" onclick="go('y_${y}')"><b>${y}</b>${ws ? `<span>${esc(ws[1].n)} win the Series</span>` : `<span>${tms.length} teams</span>`}</button>${quickList(q.filter(x => !/^New leagues: *$/i.test(x)))}</div>`; };
  return `${banner()}<div class="eyebrow">The decade</div>
  <div style="display:flex;align-items:center;gap:10px">${prev ? `<button class="iconbtn" onclick="go('d_${prev}')" aria-label="Previous decade">‹</button>` : ''}<h1 class="name" style="margin:0">${decadeName(d)}</h1>${next ? `<button class="iconbtn" onclick="go('d_${next}')" aria-label="Next decade">›</button>` : ''}</div>
  ${eras.map(e => `<h2>Your era notes <small>${e[0]}–${e[1]}</small></h2><p style="margin:0">${esc(e[2])}</p>${e[3] ? `<p class="note" style="margin-top:4px">Black clubs and independents: ${esc(e[3])}</p>` : ''}`).join('')}
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
  const pins = Object.entries(STORE.pins).filter(([, s]) => s.year === y);
  const yn = NOTES.years[y] || {};
  const champ = ([tid, t]) => `<button class="row" onclick="go('t_${tid}')">${badgeSm(t)}<span class="rn">${esc(t.n)}<small>${t.ws ? 'won the World Series' : esc(t.lg) + ' pennant'}${t.w != null ? ` · ${t.w}–${t.l}` : ''}</small></span><span class="meta">${dotsHTML('t_' + tid)}</span></button>`;
  return `${banner()}<div class="eyebrow">${y} · <a href="#" onclick="go('d_${decadeOf(y)}');return false">the ${decadeName(decadeOf(y))}</a></div>
  <div class="sub" style="margin-top:4px"><span><b>${tms.length}</b> teams</span><span><b>${tms.filter(([tid]) => litN('t_' + tid)).length}</b> explored</span>${lgs.length ? `<span>${lgs.map(l => esc(l)).join(' · ')}</span>` : ''}</div>
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
  ${pins.length ? `<h2>Your pins</h2><div class="list">${pins.map(([id, s]) => `<button class="row" onclick="go('s_${id}')"><span class="yr">${esc(s.kind || 'pin')}</span><span class="rn">${esc(s.title)}</span><span class="meta">${dotsHTML('s_' + id)}</span></button>`).join('')}</div>` : ''}
  ${tms.length ? `<details class="allteams"><summary>All ${tms.length} teams</summary><div class="chips">${tms.sort((a, b) => a[1].lg.localeCompare(b[1].lg) || a[1].rk - b[1].rk).map(([tid, t]) => `<button class="chip ${litN('t_' + tid) ? 'lit' : ''}" onclick="go('t_${tid}')"><span class="k">${esc(t.lg)}</span>${esc(t.n)}</button>`).join('')}</div></details>` : `<p class="empty">No league teams in the database this year. Your pins and era notes are the way in.</p>`}
  ${saveBox()}`;
}
function saveBox() {
  const n = Object.keys(STORE.progress).length;
  return `<div class="savebox"><div>Your check-offs, grades, clippings and pins are saved in this browser (${n} things touched). Export a copy to back up, or commit it as <code>docs/data/progress.json</code> so every device starts from it.</div>
  <div class="r"><button class="btn ghost" id="exportbtn">Export progress</button><label class="btn ghost" style="cursor:pointer">Import…<input type="file" id="importfile" accept="application/json" hidden></label><span id="savemsg"></span></div></div>`;
}

function vPlayer() {
  const k = view.id, p = D.players[k]; if (!p) return notFound();
  const key = 'p_' + k, pitcher = POSP.has(p.pos), ph = PHOTOS[k], f = fromOf(k), ov = prog(key)?.from;
  const rank = p.ovr ? `#${p.ovr} overall` : (typeof p.prk === 'string' ? `List group ${esc(p.prk)}` : 'On your list');
  const prk = typeof p.prk === 'number' ? `#${p.prk} ${esc(p.pos)}` : esc(p.pos);
  const ht = p.ht ? `${Math.floor(p.ht / 12)}′${p.ht % 12}″${p.wt ? ', ' + p.wt + ' lb' : ''}` : '';
  const ranks = (p.ranks || []).filter(r => r[1] !== 'WPA');
  const bat = p.bat, pit = p.pit, showBat = bat && (!pitcher || bat.AB > 1500), showPit = pit && (pitcher || parseFloat(pit.IP) > 300);
  const cols = (o, hs) => `<table class="stats"><tr>${hs.map(h => `<th>${h}</th>`).join('')}</tr><tr>${hs.map(h => `<td>${o[h]}</td>`).join('')}</tr></table>`;
  return `${crumbs('Player')}${banner()}
   <div class="hero">${ph ? `<figure class="photo" style="margin:0"><img src="photos/${esc(ph.file)}" alt="${esc(nameOf(p))}"><figcaption>${esc(ph.credit || '')}${ph.license ? ' · ' + esc(ph.license) : ''}</figcaption></figure>` : ''}
   <div class="who"><div class="eyebrow">${esc(rank)} · ${prk} · peak ${p.pk ? `<a href="#" onclick="go('y_${p.pk}');return false">${p.pk}</a>` : '?'}</div>
   <h1 class="name">${esc(nameOf(p))}</h1>
   <div class="sub">${f ? `<span>From ${placeLink(f)} <button class="chip" id="editfrom" style="font-size:11px;padding:1px 8px">change</button></span>` : `<span><button class="chip" id="editfrom">Set where he’s from</button></span>`}${p.have ? `<span>In your collection: <b>${esc(p.have)}</b></span>` : ''}</div></div></div>
   <form class="add" id="fromform" hidden>
     <div class="r"><input class="t" id="from-c" placeholder="City" value="${esc(f?.c || '')}"><input class="t" id="from-r" placeholder="State / province" value="${esc(f?.r || '')}"><input class="t" id="from-n" placeholder="Country" value="${esc(f?.n || 'United States')}"></div>
     <div class="r"><button class="btn" type="submit">Save</button>${ov ? '<button class="btn ghost" type="button" id="fromreset">Back to birthplace</button>' : ''}<span class="note">Wherever you think of him as being from. Birthplace is the default.</span></div>
   </form>
   ${lightsHTML(key)}
   <h2>Doors</h2>${doorsHTML(key)}
   <h2>The person</h2>
   <dl class="facts">
     ${p.born ? `<dt>Born</dt><dd>${esc(p.born)}${p.bplace ? ' · ' + esc(p.bplace) : ''}</dd>` : ''}
     ${p.died ? `<dt>Died</dt><dd>${esc(p.died)}</dd>` : ''}
     ${ht ? `<dt>Size</dt><dd>${ht}</dd>` : ''}
     ${p.bt && p.bt !== '?/?' ? `<dt>Bats/Throws</dt><dd>${esc(p.bt)}</dd>` : ''}
   </dl>
   ${p.st && p.st.length ? `<h2>Teams</h2><div class="list">${p.st.map(s => `<button class="row" onclick="go('t_${s[5]}')"><span class="yr">${s[2]}${s[3] !== s[2] ? '–' + s[3] : ''}</span><span class="rn">${esc(s[1])}</span><span class="meta">${s[4]} G ${dotsHTML('t_' + s[5])}</span></button>`).join('')}</div>` : ''}
   ${p.clubs && p.clubs.length ? `<h2>Clubs <small>outside the database</small></h2><div class="list">${p.clubs.map(c => `<div class="row" style="cursor:default"><span class="yr">${esc(c[1])}</span><span class="rn">${esc(c[0])}</span></div>`).join('')}</div>` : ''}
   ${ranks.length ? `<h2>In your top 5</h2><div class="chips">${ranks.map(r => `<button class="chip ${r[2] === 1 ? 'lit' : ''}" onclick="go('y_${r[0]}')"><span class="k">${r[0]}</span>#${r[2]} ${r[1] === 'P' ? 'pitcher' : r[1] === 'RP' ? 'reliever' : 'player'}</button>`).join('')}</div>` : ''}
   ${modelHTML(p)}
   ${showBat || showPit ? `<h2>Career numbers</h2><div class="statline">${showBat ? cols(bat, ['G', 'AB', 'H', 'HR', 'R', 'RBI', 'SB', 'BB', 'AVG', 'OBP', 'SLG']) : ''}${showPit ? `<div style="height:8px"></div>` + cols(pit, ['W', 'L', 'ERA', 'G', 'GS', 'SV', 'IP', 'SO', 'BB']) : ''}</div>` : ''}
   ${playerNotes(k)}
   <h2>Scouting card <small>your grades, one click each${p.tools ? '; outlined ones are your model’s until you choose' : ''}</small></h2>${gradesHTML(key, pitcher, p.tools)}
   <h2>Clippings <small>stories, quotes, personal details</small></h2>${clipsHTML(key)}`;
}
function playerNotes(k) {
  const ps = NOTES.players[k]; if (!ps || !ps.length) return '';
  const season = /^\d{4} \(/, seasons = ps.filter(x => season.test(x)), text = ps.filter(x => !season.test(x));
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
  return `${crumbs('Team season')}${banner()}
   <div class="hero">${teamBadge(t)}<div class="who"><div class="eyebrow">${esc(LG[t.lg] || t.lg)}${t.dv ? ' · ' + esc(t.dv) + ' division' : ''}</div>
   <div style="display:flex;align-items:center;gap:8px">${prev ? `<button class="iconbtn" onclick="go('t_${prev}')" aria-label="Previous season">‹</button>` : ''}<h1 class="name" style="margin:0">${t.y} ${esc(t.n)}</h1>${next ? `<button class="iconbtn" onclick="go('t_${next}')" aria-label="Next season">›</button>` : ''}</div></div></div>
   <div class="sub" style="margin-top:8px"><span><b>${t.w ?? '?'}–${t.l ?? '?'}</b></span>${t.rk ? `<span>finished <b>${ordinal(t.rk)}</b></span>` : ''}${t.ws ? '<span class="badge gold">World Series champions</span>' : t.pen ? '<span class="badge gold">Pennant</span>' : ''}${t.pl ? `<span>${placeLink(t.pl)}</span>` : ''}<span><a href="#" onclick="go('y_${t.y}');return false">The ${t.y} season</a></span></div>
   ${t.tr ? `<h2>By your model <small>talent and results</small></h2><div class="sub" style="margin-top:0"><span><b>${fmtS(t.tr.a)}</b> wins over an average team</span><span><b>#${t.tr.yr}</b> of ${t.tr.n} in ${t.y}</span><span><b>#${t.tr.ar}</b> all-time</span></div>
   <p class="note">Per 162 games: talent ${fmtS(t.tr.tal)} (70%), Pythagorean record ${fmtS(t.tr.py)} (20%), actual record ${fmtS(t.tr.wp)} (10%)${t.w + t.l < 150 ? ', records shrunk toward .500 for the short season' : ''}.</p>
   <p class="note">${t.tr.v} projected WAR per 162: ${t.tr.h} from position players, ${t.tr.p} from pitchers. Most of it from ${t.tr.top.map(e => e[1] ? `<a href="#" onclick="go('p_${e[1]}');return false">${esc(e[0])}</a> (${e[2]})` : `${esc(e[0])} (${e[2]})`).join(', ')}.</p>` : ''}
   ${park || t.park ? `<h2>Ballpark</h2><div class="parkbox"><b>${esc(park ? park.n : t.park)}</b>${park ? ` · ${esc(park.c)} · used ${park.y0}–${park.y1}${park.al ? `<div class="note">Also called ${esc(park.al)}</div>` : ''}${park.note ? `<div class="note">Your note: ${esc(park.note)}</div>` : ''}` : (t.ap ? ' <span class="note">(map pin at the city)</span>' : '')}</div>` : ''}
   ${lightsHTML(key)}
   <h2>Doors</h2>${doorsHTML(key)}
   <h2>From your list <small>${ro.length} on this roster${t.ros ? ', best season first' : ''}</small></h2>${ro.length ? `<div class="chips">${ro.map(k => t.ros && k in t.ros ? playerChip(k).replace('</button>', ` <span class="k">${fmtS(t.ros[k])}</span></button>`) : playerChip(k)).join('')}</div>` : '<p class="empty">Nobody from your list played here this year.</p>'}
   ${t.mb && t.mb.length ? `<h2>Best on the roster <small>by your model, this season</small></h2>${modelList(t.mb.map(e => [...e, null]))}` : ''}
   ${gms.length ? `<h2>Great games</h2><div class="list">${gms.map(gameRow).join('')}</div>` : ''}
   <h2>The franchise <small>${esc(fr ? fr.n : t.n)}</small></h2>
   <div class="list">${eras.map(e => `<button class="row" onclick="go('t_${e.tid}')"><span class="yr">${e.y0}${e.y1 !== e.y0 ? '–' + e.y1 : ''}</span><span class="rn">${esc(e.n)}${e.c ? `<small>${esc(e.c)}</small>` : ''}</span></button>`).join('')}</div>
   <h2>Clippings</h2>${clipsHTML(key)}`;
}
function vGame() {
  const g = D.games[view.id]; if (!g) return notFound(); const key = 'g_' + g.rk;
  return `${crumbs('Game')}${banner()}<div class="eyebrow">#${g.rk} on your greatest-games list${g.gr ? ' · marked great' : ''}</div>
   <h1 class="name">${g.y} ${esc(g.g)}</h1><p style="font-size:17px;margin:0">${esc(g.d || 'No description yet.')}</p>
   <div class="sub" style="margin-top:8px">${g.tid ? `<span>${esc(D.teams[g.tid].n)}: <a href="#" onclick="go('t_${g.tid}');return false">${g.y} season</a></span>` : ''}<span><a href="#" onclick="go('y_${g.y}');return false">More from ${g.y}</a></span></div>
   ${lightsHTML(key)}<h2>Doors</h2>${doorsHTML(key)}
   <h2>Your numbers</h2><dl class="facts">${g.sc != null ? `<dt>Your score</dt><dd>${g.sc}</dd>` : ''}${g.cw != null ? `<dt>Top cWPA play</dt><dd>${g.cw}</dd>` : ''}${g.wpa != null ? `<dt>Top WPA play</dt><dd>${g.wpa}</dd>` : ''}${g.li != null ? `<dt>Game leverage</dt><dd>${g.li}</dd>` : ''}${g.inn ? `<dt>Innings</dt><dd>${g.inn}</dd>` : ''}</dl>
   <h2>Clippings</h2>${clipsHTML(key)}`;
}
function vPin() {
  const s = STORE.pins[view.id]; if (!s) return `${crumbs('Pin')}<p class="empty">This pin isn’t here anymore.</p>`; const key = 's_' + view.id;
  return `${crumbs('Your pin')}${banner()}<div class="eyebrow">${esc(s.kind || 'Pin')}${s.year ? ` · <a href="#" onclick="go('y_${s.year}');return false">${s.year}</a>` : ''}${s.place ? ' · ' + esc(s.place) : ''}</div>
   <h1 class="name">${esc(s.title)}</h1>${s.text ? `<p style="margin:0">${esc(s.text)}</p>` : ''}${s.url ? `<p><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a></p>` : ''}
   ${lightsHTML(key)}<h2>Doors</h2>${doorsHTML(key)}<h2>Clippings</h2>${clipsHTML(key)}<h2>Edit</h2>${pinForm(s)}`;
}
let PLACE_OPTS = null;
function placeOptions() {
  if (PLACE_OPTS) return PLACE_OPTS; PLACE_OPTS = {};
  for (const nd of Object.values(PL)) if (nd.lvl === 2 && nd.lls.length) PLACE_OPTS[placeText(nd) || nd.n] = nd.lls[0];
  return PLACE_OPTS;
}
function pinForm(s) {
  s = s || {};
  return `<form class="add" id="pinform">
   <input class="t" id="pin-title" required placeholder="What happened (e.g. Jim Creighton’s last game)" value="${esc(s.title || '')}">
   <div class="r"><select class="t" id="pin-kind" style="flex:0 0 auto">${['Story', 'Moment', 'Person', 'Reel', 'Place', 'Other'].map(k => `<option ${s.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
   <input class="t" id="pin-year" type="number" min="1800" max="2030" placeholder="Year" value="${esc(s.year || '')}" style="flex:0 0 110px">
   <input class="t" id="pin-place" list="placelist" placeholder="Place: a city, or lat, lon" value="${esc(s.place || '')}"></div>
   <textarea class="t" id="pin-text" placeholder="A line or two, if you want">${esc(s.text || '')}</textarea>
   <input class="t" id="pin-url" type="url" placeholder="Link (optional)" value="${esc(s.url || '')}">
   <div class="r"><button class="btn" type="submit">${s.title ? 'Save changes' : 'Add to the map'}</button>${s.title ? `<button class="btn ghost" type="button" id="pindel">Delete pin</button><span id="pindelconfirm" hidden><button class="btn" type="button" id="pindelyes">Yes, delete it</button></span>` : ''}<span class="note" id="pinmsg"></span></div>
  </form>`;
}
const vAddPin = () => `${crumbs('Add a pin')}${banner()}<div class="eyebrow">For the stories that aren’t a player or a team</div><h1 class="name">Add a pin</h1><p class="note">Creighton in Brooklyn, the Emperor’s game in Tokyo, a reel you love. It goes on the map at its place and year, with its own doors and clippings.</p>${pinForm(null)}
  <h2>Your pins <small>${Object.keys(STORE.pins).length}</small></h2>${Object.keys(STORE.pins).length ? `<div class="list">${Object.entries(STORE.pins).sort((a, b) => (a[1].year || 0) - (b[1].year || 0))
    .map(([id, s]) => `<button class="row" onclick="go('s_${id}')"><span class="yr">${s.year || ''} ${esc(s.kind || '')}</span><span class="rn">${esc(s.title)}<small>${esc(s.place || '')}</small></span><span class="meta">${dotsHTML('s_' + id)}</span></button>`).join('')}</div>` : '<p class="empty">No pins yet.</p>'}`;

/* ---------------- homes: players, games, teams ---------------- */
const RK = { players: { f: '', sort: 'rank', pos: 'All' }, games: { f: '', sort: 'rank' }, teams: { f: '', grp: 'all', mode: 'rank', n: 100 } };
const LGROUP = { AL: 'mlb', NL: 'mlb', NA: 'early', AA: 'early', UA: 'early', PL: 'early', FL: 'early',
  NNL: 'negro', NN2: 'negro', ECL: 'negro', ANL: 'negro', EWL: 'negro', NSL: 'negro', NAL: 'negro' };
const GROUPS = [['mlb', 'American & National League'], ['early', '19th-century majors & Federal League'], ['negro', 'Negro Leagues'], ['ind', 'Independent clubs']];
function vList() {
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
    const arr = Object.values(D.games).filter(g => !f || (g.y + ' ' + g.g + ' ' + g.d).toLowerCase().includes(f));
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
     <p class="note">Each player’s projected WAR per game for that season, weighted by his games for the team, summed and put on a 162-game scale. That talent, measured against a typical team of its era (a smooth curve over time), makes up 70% of the score; Pythagorean record is 20% and actual record 10% (shrunk toward .500 in short seasons), all in wins over an average team per 162, with your model’s 1800s discount.</p>
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
    return `<h2>${label} <small>${xs.length}</small></h2><div class="list">${xs.map(x => `<div class="row frow">${badgeSm(x.last)}<span class="yr">${x.ts[0].y}–${x.last.y}</span><span class="rn"><a href="#" onclick="go('t_${x.fr.s[x.fr.s.length - 1]}');return false">${esc(x.last.n)}</a><small>${x.eras.length > 1 ? x.eras.map(e => `<a href="#" onclick="go('t_${e.tid}');return false">${esc(e.n)}</a> ${e.y0}${e.y1 !== e.y0 ? '–' + e.y1 : ''}`).join(' · ') : `${x.ts.length} season${x.ts.length > 1 ? 's' : ''}`}</small></span><span class="meta" title="seasons explored">${x.fr.s.filter(tid => litN('t_' + tid)).length}/${x.ts.length}</span></div>`).join('')}</div>`;
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
  return `${banner()}<div class="placecrumbs">${trail.join('')}</div><div class="eyebrow">${['Country', 'State / region', 'City'][nd.lvl]}</div><h1 class="name">${esc(placeLabel(nd))}</h1>
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
  if (t === 'y' || t === 'a') MAPMODE = 'teams';
  if (t === 'y') { const lls = Object.values(D.teams).filter(x => x.y === YEAR && x.ll).map(x => x.ll); if (lls.length) fit = lls; }
  if (t === 'd') { MAPMODE = 'teams'; const d0 = view.id === 'pre' ? 1845 : +view.id; if (YEAR < d0 || YEAR > (view.id === 'pre' ? 1870 : d0 + 9)) { YEAR = view.id === 'pre' ? 1870 : Math.max(d0, 1871); $('#yr').value = YEAR; $('#bigyear').textContent = YEAR; } }
  if (t === 't') { const tm = D.teams[view.id]; if (tm) { MAPMODE = 'teams'; if (YEAR !== tm.y) { YEAR = tm.y; $('#yr').value = YEAR; $('#bigyear').textContent = YEAR; } highlight = 't_' + view.id; if (tm.ll) fit = [tm.ll]; } }
  if (t === 'g') { const g = D.games[view.id]; if (g) { MAPMODE = 'teams'; YEAR = g.y; $('#yr').value = YEAR; $('#bigyear').textContent = YEAR; if (g.tid) { highlight = 't_' + g.tid; const tm = D.teams[g.tid]; if (tm.ll) fit = [tm.ll]; } } }
  if (t === 's') { const s = STORE.pins[view.id]; MAPMODE = 'teams'; if (s && s.ll) { focusPts = [{ ll: s.ll, label: s.title, key: 's_' + view.id, r: 8 }]; fit = [s.ll]; if (s.year) { YEAR = s.year; $('#yr').value = YEAR; $('#bigyear').textContent = YEAR; } } }
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
  const drafts = {}; for (const id of ['clip-t', 'clip-u', 'pin-title', 'pin-year', 'pin-place', 'pin-text', 'pin-url', 'rkfilter']) { const el = document.getElementById(id); if (el) drafts[id] = el.value; }
  const V = { d: vDecade, y: vYear, p: vPlayer, t: vTeam, g: vGame, s: vPin, a: vAddPin, r: vList, l: vPlace };
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
  $('#editfrom')?.addEventListener('click', () => { $('#fromform').hidden = !$('#fromform').hidden; });
  $('#fromform')?.addEventListener('submit', e => { e.preventDefault();
    const c = $('#from-c').value.trim(), r = $('#from-r').value.trim(), n = $('#from-n').value.trim() || 'United States'; if (!c && !r) return;
    const known = Object.values(PL).find(nd => nd.lvl === 2 && nd.n.toLowerCase() === n.toLowerCase() && (nd.c || '').toLowerCase() === c.toLowerCase() && (!r || (nd.r || '').toLowerCase() === r.toLowerCase()) && nd.lls.length);
    mutate(key, cur => { cur.from = { c: c || null, r: r || null, n, ll: known ? known.lls[0] : null }; }); buildPlaces(); PLACE_OPTS = null; render(true); });
  $('#fromreset')?.addEventListener('click', () => { mutate(key, cur => { delete cur.from; }); buildPlaces(); PLACE_OPTS = null; render(true); });
  // home lists
  const st = view.type === 'r' ? RK[view.id] : null;
  document.querySelectorAll('[data-pos]').forEach(b => b.addEventListener('click', () => { st.pos = b.dataset.pos; render(false); }));
  document.querySelectorAll('[data-grp]').forEach(b => b.addEventListener('click', () => { st.grp = b.dataset.grp; st.n = 100; render(false); }));
  document.querySelectorAll('[data-tmode]').forEach(b => b.addEventListener('click', () => { st.mode = b.dataset.tmode; render(false); }));
  $('#tmore')?.addEventListener('click', () => { st.n += 200; render(false); });
  $('#rksort')?.addEventListener('change', e => { st.sort = e.target.value; render(false); });
  $('#rkfilter')?.addEventListener('input', e => { st.f = e.target.value; clearTimeout(window.__rf); window.__rf = setTimeout(() => render(false), 150); });
  // pins
  $('#pinform')?.addEventListener('submit', e => { e.preventDefault(); savePin(view.type === 's' ? view.id : null); });
  $('#pindel')?.addEventListener('click', () => { $('#pindelconfirm').hidden = false; });
  $('#pindelyes')?.addEventListener('click', () => { delete STORE.pins[view.id]; deletedPins.add(view.id); persist(); go('y_' + YEAR); });
  // export/import
  $('#exportbtn')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ progress: STORE.progress, pins: STORE.pins, deletedPins: [...deletedPins], exportedAt: new Date().toISOString() }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'progress.json'; document.body.appendChild(a); a.click(); a.remove();
    $('#savemsg').textContent = 'Saved progress.json to your downloads.';
  });
  $('#importfile')?.addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); loadStore(j); persist(); buildPlaces(); render(true); setTimeout(() => { const m = $('#savemsg'); if (m) m.textContent = 'Imported.'; }, 0); }
    catch (err) { $('#savemsg').textContent = 'That file isn’t an atlas progress export.'; } });
}
function parsePlace(s) {
  s = (s || '').trim(); if (!s) return null;
  const m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/); if (m) return [+m[1], +m[2]];
  const opts = placeOptions(); if (opts[s]) return opts[s];
  const low = s.toLowerCase(), hit = Object.keys(opts).find(k => k.toLowerCase().startsWith(low)) || Object.keys(opts).find(k => k.toLowerCase().includes(low));
  return hit ? opts[hit] : null;
}
function savePin(id) {
  const title = $('#pin-title').value.trim(); if (!title) return;
  const place = $('#pin-place').value.trim(), ll = parsePlace(place);
  if (place && !ll) { $('#pinmsg').textContent = 'Couldn’t place that. Pick a suggestion, or type “lat, lon”.'; return; }
  const body = { title, kind: $('#pin-kind').value, year: +$('#pin-year').value || null, place, ll, text: $('#pin-text').value.trim(), url: $('#pin-url').value.trim(), at: Date.now() };
  const nid = id || ('pin' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  STORE.pins[nid] = body; deletedPins.delete(nid); persist();
  go('s_' + nid, !id);
}
function spin() {
  const pool = [
    ...Object.keys(D.players).flatMap(k => ['p_' + k, 'p_' + k]),
    ...Object.entries(D.teams).filter(([, t]) => t.pen || t.ws || (t.ro && t.ro.length >= 3)).map(([k]) => 't_' + k),
    ...Object.keys(D.games).filter(k => D.games[k].gr).map(k => 'g_' + k),
    ...Object.keys(STORE.pins).map(k => 's_' + k),
  ];
  for (let i = 0; i < 300; i++) { const k = pool[Math.floor(Math.random() * pool.length)]; if (!litN(k)) { go(k); return; } }
  go(pool[Math.floor(Math.random() * pool.length)]);
}

/* ================================================================ search */
let IDX = [], selI = 0;
function buildIndex() {
  IDX = [];
  for (const [k, p] of Object.entries(D.players)) IDX.push({ t: nameOf(p), s: `${p.pos} · peak ${p.pk}`, key: 'p_' + k, w: 3 });
  for (const [k, g] of Object.entries(D.games)) IDX.push({ t: `${g.y} ${g.g} ${g.d}`, s: 'game #' + g.rk, key: 'g_' + k, w: 1 });
  for (const nd of Object.values(PL)) if (nd.from.length || nd.teams.length > 20) IDX.push({ t: placeLabel(nd), s: ['country', 'state / region', 'city'][nd.lvl] + (nd.lvl ? ' · ' + nd.n : ''), key: 'l_' + enc(nd.k), w: 2 });
}
function doSearch(q) {
  const box = $('#results'); q = q.trim().toLowerCase(); if (q.length < 2) { box.hidden = true; return; }
  const out = [], ym = q.match(/^(1[89]\d\d|20[0-2]\d)\b\s*(.*)$/);
  if (ym && !ym[2]) out.push({ t: 'The ' + ym[1] + ' season', s: 'year', key: 'y_' + ym[1], sc: 9 });
  const dm = q.match(/^(1[89]\d|20[0-2])0s$/); if (dm) out.push({ t: 'The ' + q, s: 'decade', key: 'd_' + dm[1] + '0', sc: 10 });
  if (ym && ym[2]) for (const [tid, t] of Object.entries(D.teams)) if (t.y === +ym[1] && t.n.toLowerCase().includes(ym[2])) out.push({ t: `${t.y} ${t.n}`, s: LG[t.lg] || t.lg, key: 't_' + tid, sc: 8 });
  for (const it of IDX) { const tl = it.t.toLowerCase(); if (tl.includes(q)) out.push({ ...it, sc: (tl.startsWith(q) ? 2 : 0) + (tl.split(' ').some(w => w.startsWith(q)) ? 1 : 0) + it.w }); }
  for (const fr of Object.values(D.franch)) { const names = new Set(fr.s.map(s => D.teams[s].n)); for (const n of names) if (n.toLowerCase().includes(q)) { const s = fr.s.filter(x => D.teams[x].n === n); out.push({ t: n, s: `${D.teams[s[0]].y}–${D.teams[s[s.length - 1]].y}`, key: 't_' + s[s.length - 1], sc: 2.5 }); } }
  for (const [id, s] of Object.entries(STORE.pins)) if (s.title.toLowerCase().includes(q)) out.push({ t: s.title, s: 'your pin', key: 's_' + id, sc: 4 });
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
  loadStore(await getJSON('data/progress.json', {}));
  buildPlaces(); buildIndex();
  const dl = document.createElement('datalist'); dl.id = 'placelist'; dl.innerHTML = Object.keys(placeOptions()).sort().map(p => `<option value="${esc(p)}">`).join(''); document.body.appendChild(dl);
  setupMap();
  addEventListener('resize', () => { clearTimeout(window.__rs); window.__rs = setTimeout(() => placeMap(false), 200); });
  $('#yr').addEventListener('input', e => { stopPlay(); setYear(+e.target.value); });
  $('#play').addEventListener('click', () => { if (playT) { stopPlay(); return; } $('#play').textContent = '❚❚'; if (view.type !== 'y') go('y_' + YEAR); playT = setInterval(() => { if (YEAR >= 2025) { stopPlay(); return; } setYear(YEAR + 1); }, 650); });
  $('#ly-pins').addEventListener('click', e => { showPins = !showPins; e.currentTarget.setAttribute('aria-pressed', showPins); drawBase(); });
  $('#q').addEventListener('input', e => doSearch(e.target.value));
  $('#q').addEventListener('keydown', e => { const bs = [...$('#results').querySelectorAll('button')]; if (!bs.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); selI = (selI + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length; bs.forEach((b, i) => b.classList.toggle('sel', i === selI)); }
    if (e.key === 'Enter') { e.preventDefault(); bs[selI].click(); } if (e.key === 'Escape') $('#results').hidden = true; });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) $('#results').hidden = true; });
  $('#home').addEventListener('click', () => goHome('map')); $('#home').addEventListener('keydown', e => { if (e.key === 'Enter') goHome('map'); });
  for (const h of HOMES) $('#home-' + h).addEventListener('click', () => goHome(h));
  $('#addpin').addEventListener('click', () => go('a_new'));
  $('#ml-teams').addEventListener('click', () => go('y_' + YEAR)); $('#ml-places').addEventListener('click', () => go('l_world'));
  for (const id of ['#mapexpand', '#mapfab']) $(id).addEventListener('click', () => setFull(true));
  $('#mapclose').addEventListener('click', () => setFull(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && FULL) setFull(false); });
  $('#spin').addEventListener('click', spin);
  $('#yprev').addEventListener('click', () => { stopPlay(); setYear(YEAR - 1); });
  $('#ynext').addEventListener('click', () => { stopPlay(); setYear(YEAR + 1); });
  $('#searchbtn').addEventListener('click', () => { const on = $('#top').classList.toggle('searching'); if (on) $('#q').focus(); });
  $('#q').addEventListener('blur', () => setTimeout(() => { if (!$('#q').value) $('#top').classList.remove('searching'); }, 200));
  const m = (location.hash || '').slice(1).match(/^([ptgsyarld])-(.+)$/);
  if (m) { view = { type: m[1], id: m[1] === 'r' && !HOMES.includes(m[2]) ? 'players' : m[2] }; if (m[1] === 'y') YEAR = +m[2]; }
  if (homeOf(view) === 'map') lastMap = view;
  $('#yr').value = YEAR; $('#bigyear').textContent = YEAR;
  render(true);
})();
