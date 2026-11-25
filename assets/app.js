/* PitchEdge research site
   Data comes from data/*.json, built by scripts/build_data.py from each model's repo. */

/* ============ SETTINGS ============ */
// Flip to true before opening the site to the public: hides every play and record
// built on PFF data (CFB receiving props + matchup grades), per PFF's license terms.
const HIDE_PFF = false;
const TZ = 'America/Phoenix';
const STALE_HOURS = { cfb: 30, cbb: 20, nfl: 100 };
const ORDER = ['cfb', 'cbb', 'nfl', 'nba', 'soccer', 'golf'];

/* ============ helpers ============ */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sgn = x => (x > 0 ? '+' : '') + x;
const dayKey = d => d.toLocaleDateString('en-CA', { timeZone: TZ });
function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}
function fmtDay(iso) {
  const d = new Date(iso), now = new Date();
  const k = dayKey(d);
  if (k === dayKey(now)) return 'Today';
  if (k === dayKey(new Date(now.getTime() + 864e5))) return 'Tomorrow';
  if (k === dayKey(new Date(now.getTime() - 864e5))) return 'Yesterday';
  return d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric' });
}
function fmtWhen(iso) {
  if (!iso) return '—';
  return fmtDay(iso) + ' ' + fmtTime(iso);
}
function ago(iso) {
  const h = (Date.now() - new Date(iso)) / 36e5;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm ago';
  if (h < 48) return Math.round(h) + 'h ago';
  return Math.round(h / 24) + 'd ago';
}
const price = p => p == null ? '' : (p > 0 ? '+' + Math.round(p) : String(Math.round(p)));
const pct = x => x == null ? '—' : Math.round(x * 100) + '%';
const MARKET = { spread: 'Spread', total: 'Total', moneyline: 'Moneyline', prop: 'Prop', outright: 'Outright' };

let TODAY = null;
const CACHE = {};
async function getJSON(path) {
  const r = await fetch(path + '?v=' + Math.floor(Date.now() / 3e5), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function sportData(id) {
  if (!CACHE[id]) CACHE[id] = await getJSON(`data/${id}.json`);
  return CACHE[id];
}
const visible = p => !(HIDE_PFF && (p.flags || []).includes('pff'));
const sportOf = id => (TODAY.sports || []).find(s => s.id === id) || { id, name: id.toUpperCase(), full: id };

function sportStatus(s) {
  if (s.error) return ['NO DATA', 'err'];
  if (s.status === 'sample') return ['SAMPLE', 'sample'];
  if (s.status === 'offseason') return ['OFF SEASON', ''];
  if (s.status === 'onhold') return ['ON HOLD', ''];
  if (s.updated && STALE_HOURS[s.id] && (Date.now() - new Date(s.updated)) / 36e5 > STALE_HOURS[s.id]) return ['STALE', 'stale'];
  return ['LIVE', 'live'];
}

/* ============ shared pieces ============ */
function edgeHTML(p) {
  if (p.edge == null) return '<div class="edge"><span class="ev dim">—</span></div>';
  const scale = p.edge_unit === 'pts' ? 15 : p.edge_unit === 'pts of prob' ? 25 : 40;
  const w = Math.max(4, Math.min(100, Math.abs(p.edge) / scale * 100));
  const unit = p.edge_unit === 'pts' ? ' pts' : p.edge_unit === 'pts of prob' ? ' pts' : '%';
  return `<div class="edge ${p.grade === 'A' ? 'hot' : ''}" title="Edge: ${esc(p.edge)} ${esc(p.edge_unit)}"><div class="bar"><i style="width:${w}%"></i></div><span class="ev num">${p.edge}${unit}</span></div>`;
}
function gradeHTML(p) {
  if (p.grade) return `<span class="grade ${esc(p.grade)}" title="Grade ${esc(p.grade)}">${esc(p.grade)}</span>`;
  if (p.confidence) return `<span class="grade ${p.confidence === 'High' ? 'A' : p.confidence === 'Low' ? 'C' : ''}" title="${esc(p.confidence)} confidence" style="font-size:9.5px">${esc(p.confidence.slice(0, 3).toUpperCase())}</span>`;
  return `<span class="grade none" title="${p.official ? 'Official, ungraded' : 'Model lean, not official'}">${p.official ? '—' : 'LEAN'}</span>`;
}
function tagsHTML(p) {
  const t = [];
  if (p.sample) t.push('<span class="tag sample">SAMPLE</span>');
  if (!p.official) t.push('<span class="tag lean">model lean</span>');
  (p.tags || []).filter(x => x && x !== 'model lean').forEach(x => t.push(`<span class="tag">${esc(x)}</span>`));
  if ((p.flags || []).includes('pff')) t.push('<span class="tag pff" title="Built on PFF data: personal use only">PFF</span>');
  return t.length ? `<div class="tags">${t.join('')}</div>` : '';
}
function rowHTML(p) {
  const s = sportOf(p.sport);
  const mk = MARKET[p.market] || p.market;
  return `<div class="row">
    <div class="t num">${p.start ? fmtTime(p.start) : esc((p.tags || []).find(x => /^Week/.test(x)) || 'TBD')}</div>
    <div class="sp"><span class="badge">${esc(s.name)}</span></div>
    <div class="ev" title="${esc(p.event)}">${esc(mk)} · ${esc(p.event)}</div>
    <div class="pkc"><div class="pk" title="${esc(p.pick)}">${esc(p.pick)}${p.price != null ? `<span class="px num">${price(p.price)}</span>` : ''}${p.book ? `<span class="px">${esc(p.book)}</span>` : ''}</div>${tagsHTML(p)}</div>
    <div class="md num">Model <b>${esc(p.model ?? '—')}</b></div>
    ${edgeHTML(p)}
    <div class="gc">${gradeHTML(p)}</div>
  </div>`;
}
const COLHEAD = `<div class="colhead"><span>Time</span><span>Sport</span><span>Market · Game</span><span>Model play</span><span>Model</span><span>Edge</span><span>Grade</span></div>`;

function boardHTML(plays) {
  if (!plays.length) return `<div class="board"><div class="empty">No plays match these filters right now.</div></div>`;
  plays = [...plays].sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));
  const groups = new Map();
  plays.forEach(p => {
    const k = p.start ? fmtDay(p.start) : 'This week (game times not in feed)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  });
  let h = '<div class="board">' + COLHEAD;
  for (const [k, list] of groups) h += `<div class="dayhead">${esc(k)} · ${list.length}</div>` + list.map(rowHTML).join('');
  return h + '</div>';
}

function bannerFor(s) {
  if (s.status === 'sample') return `<div class="banner sample"><b>SAMPLE</b><span>${esc(s.full)} has no live model yet. Everything on this page is invented to preview the layout, and none of it counts toward any record.</span></div>`;
  if (s.status === 'offseason') return `<div class="banner off"><span>${esc(s.note || 'Off season.')}</span></div>`;
  if (s.error) return `<div class="banner off"><span>${esc(s.error)} Showing the last good data.</span></div>`;
  return '';
}

/* ============ pages ============ */
const F = { sport: 'all', market: 'all', show: 'official', sample: true };

function pageToday() {
  const sports = ORDER.map(sportOf).filter(s => s.id);
  const all = (TODAY.plays || []).filter(visible);
  const tiles = sports.map(s => {
    const ps = all.filter(p => p.sport === s.id && p.official);
    const a = ps.filter(p => p.grade === 'A').length;
    const [lab, cls] = sportStatus(s);
    const sub = s.status === 'offseason' ? 'Off season' : s.status === 'sample' ? 'Sample data' : s.updated ? 'Updated ' + ago(s.updated) : '';
    return `<a class="tile" href="#/s/${s.id}"><div class="k"><span class="dot ${cls}"></span>${esc(s.full)}</div>
      <div class="v num">${s.status === 'offseason' ? '—' : ps.length}${a ? `<span class="a">${a} A</span>` : ''}</div><div class="s">${esc(sub)}</div></a>`;
  }).join('');

  let list = all.filter(p => (F.sport === 'all' || p.sport === F.sport) && (F.market === 'all' || p.market === F.market) && (F.sample || !p.sample));
  if (F.show === 'official') list = list.filter(p => p.official);
  if (F.show === 'a') list = list.filter(p => p.official && (p.grade === 'A' || p.confidence === 'High'));
  const sportsWith = ORDER.filter(id => all.some(p => p.sport === id));

  $('#app').innerHTML = `
    <div class="phead"><div><h1>Today's model board</h1><div class="sub">Every sport's current model plays in one place · times in Arizona time</div></div></div>
    <div class="tiles">${tiles}</div>
    <div class="filters">
      <div class="seg" data-f="sport"><button data-v="all" class="${F.sport === 'all' ? 'on' : ''}">All</button>${sportsWith.map(id => `<button data-v="${id}" class="${F.sport === id ? 'on' : ''}">${esc(sportOf(id).name)}</button>`).join('')}</div>
      <div class="seg" data-f="show"><button data-v="official" class="${F.show === 'official' ? 'on' : ''}">Official</button><button data-v="a" class="${F.show === 'a' ? 'on' : ''}">Top grade</button><button data-v="all" class="${F.show === 'all' ? 'on' : ''}">+ Leans</button></div>
      <select data-f="market"><option value="all">All markets</option>${['spread', 'total', 'moneyline', 'prop'].map(m => `<option value="${m}" ${F.market === m ? 'selected' : ''}>${MARKET[m]}s</option>`).join('')}</select>
      <label class="muted" style="font-size:12.5px;display:flex;gap:6px;align-items:center"><input type="checkbox" data-f="sample" ${F.sample ? 'checked' : ''}> Sample sports</label>
      <span class="count num">${list.length} plays</span>
    </div>
    ${boardHTML(list)}`;
}

async function pageSport(id, tab) {
  const s = sportOf(id);
  $('#app').innerHTML = '<div class="loading">Loading…</div>';
  let d;
  try { d = await sportData(id); } catch (e) { $('#app').innerHTML = `<div class="empty">Couldn't load ${esc(s.full)} data.</div>`; return; }
  const [lab, cls] = sportStatus(s);
  const isGolf = id === 'golf';
  tab = tab || (isGolf ? 'event' : 'plays');
  const tabs = isGolf ? [['event', 'Last event']] : [['plays', 'Plays'], ['games', 'Games'], ['record', 'Record']];
  let body = '';
  if (tab === 'plays') {
    const plays = (d.plays || []).filter(visible);
    const mk = [...new Set(plays.map(p => p.market))];
    const fm = F['m_' + id] || 'all';
    const list = plays.filter(p => fm === 'all' || p.market === fm);
    body = `<div class="filters"><div class="seg" data-f="m_${id}"><button data-v="all" class="${fm === 'all' ? 'on' : ''}">All</button>${mk.map(m => `<button data-v="${m}" class="${fm === m ? 'on' : ''}">${MARKET[m]}s</button>`).join('')}</div><span class="count num">${list.length} plays</span></div>` + boardHTML(list);
  } else if (tab === 'games') body = gamesHTML(id, d);
  else if (tab === 'record') body = recordCard(s, d, true);
  else if (tab === 'event') body = golfHTML(d);

  $('#app').innerHTML = `
    <div class="phead"><div><h1>${esc(s.full)}</h1>
      <div class="sub status"><span class="pill ${cls}">${lab}</span>${s.updated ? `Updated ${fmtWhen(s.updated)} · ${ago(s.updated)}` : ''}${s.week ? ` · Week ${s.week}` : ''}</div></div></div>
    ${bannerFor(s)}
    <div class="subtabs">${tabs.map(([k, l]) => `<a href="#/s/${id}/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    ${body}`;
}

function gamesHTML(id, d) {
  const g = d.games || [];
  if (!g.length) return '<div class="board"><div class="empty">No upcoming games in the feed.</div></div>';
  if (id === 'soccer') {
    const trio = (a, b, c) => `<span class="num">${pct(a)} · ${pct(b)} · ${pct(c)}</span>`;
    return `<div class="tblwrap"><table class="tbl"><thead><tr><th>Kickoff</th><th>Match</th><th>Model H · D · A</th><th>Market H · D · A</th><th class="r">xG</th></tr></thead><tbody>${g.map(x => `
      <tr><td class="num muted">${fmtWhen(x.start)}</td><td><b>${esc(x.home)}</b> vs ${esc(x.away)}</td><td>${trio(x.model_home, x.model_draw, x.model_away)}</td><td class="muted">${trio(x.market_home, x.market_draw, x.market_away)}</td><td class="r num">${x.xg_home} – ${x.xg_away}</td></tr>`).join('')}</tbody></table></div>`;
  }
  const diffCell = (m, k) => {
    if (m == null || k == null) return '<td class="r dim">—</td>';
    const d2 = Math.round((m - k) * 10) / 10;
    return `<td class="r num diff ${Math.abs(d2) >= (id === 'cbb' || id === 'nba' ? 6 : 4) ? 'big' : ''}">${sgn(d2)}</td>`;
  };
  return `<div class="tblwrap"><table class="tbl"><thead><tr><th>${id === 'nfl' ? 'Week' : 'Start'}</th><th>Matchup</th><th class="r">Market spread</th><th class="r">Model</th><th class="r">Diff</th><th class="r">Market total</th><th class="r">Model</th><th class="r">Diff</th><th>Home win (model)</th></tr></thead><tbody>${g.map(x => `
    <tr><td class="num muted">${x.start ? fmtWhen(x.start) : 'Wk ' + esc(x.week)}</td>
      <td><div class="mu"><span class="muted">${esc(x.away)}</span><span>@ ${esc(x.home)}</span></div></td>
      <td class="r num">${x.market_spread == null ? '—' : sgn(x.market_spread)}</td><td class="r num">${x.model_spread == null ? '—' : sgn(x.model_spread)}</td>${diffCell(x.model_spread, x.market_spread)}
      <td class="r num">${x.market_total ?? '—'}</td><td class="r num">${x.model_total == null ? '—' : Math.round(x.model_total * 10) / 10}</td>${diffCell(x.model_total, x.market_total)}
      <td><div class="wp"><div class="bar"><i style="width:${Math.round((x.home_win_prob || 0) * 100)}%"></i></div><span class="num muted">${pct(x.home_win_prob)}</span></div></td></tr>`).join('')}</tbody></table></div>
    <p class="dim" style="font-size:12px;margin-top:8px">Spreads are from the home team's side (negative = home favored). Diff is model minus market.</p>`;
}

function golfHTML(d) {
  const e = d.last_event || {};
  const mk = e.markets || {};
  const card = (label, rows) => {
    rows = rows.slice(0, 12);
    const mx = Math.max(...rows.map(x => x.model), 1);
    return `<div class="rcard"><h2>${esc(label)}</h2>
      <table class="tbl golf"><tbody>${rows.map((r, i) => `<tr><td class="dim num">${i + 1}</td><td>${esc(r.player)}</td><td style="width:40%"><div class="cmp"><div class="bars"><i class="m" style="width:${r.model / mx * 100}%"></i></div></div></td><td class="r num">${r.model}%</td></tr>`).join('')}</tbody></table></div>`;
  };
  return `<p class="muted" style="margin:0 0 12px">${esc(e.event || '')} · ${esc(e.course || '')} · ${esc(e.field || '')} players. The model's pre-tournament odds for its top 12 in each market. Live odds return with the first event in January.</p>
    <div class="golfgrid">${Object.entries(mk).map(([k, v]) => card(k, v)).join('')}</div>`;
}

function recRow(r) {
  const x = r.record || {};
  const wl = x.w == null ? (x.n != null ? `${x.n} bets` : '—') : `${x.w}-${x.l}${x.p ? '-' + x.p : ''}`;
  const u = x.units == null ? '' : `<span class="${x.units >= 0 ? 'pos' : 'neg'}">${sgn(x.units)}u</span>`;
  const roi = x.roi == null ? '' : `<span class="${x.roi >= 0 ? 'pos' : 'neg'}">${sgn(x.roi)}% ROI</span>`;
  const gs = r.grades ? `<div class="gsplit">${Object.entries(r.grades).filter(([, g]) => g.w + g.l > 0).map(([k, g]) => `<span>${k}: ${g.w}-${g.l} · ${g.roi == null ? '' : sgn(g.roi) + '%'}</span>`).join('')}</div>` : '';
  return `<div class="rrow"><span class="m">${esc(r.market)}${(r.flags || []).includes('pff') ? ' <span class="tag pff">PFF</span>' : ''}</span><span class="wl num">${wl}</span>
    <span></span><span class="u num">${[u, roi].filter(Boolean).join(' · ')}</span>${gs}<span class="n">${esc(r.note || '')}</span></div>`;
}
function recordCard(s, d, single) {
  const [lab, cls] = sportStatus(s);
  const rows = (d.records || []).filter(r => !(HIDE_PFF && (r.flags || []).includes('pff')));
  const inner = rows.length ? rows.map(recRow).join('') : `<div class="rrow"><span class="n">${s.status === 'sample' ? 'Sample sport: no record is kept.' : 'No graded results yet.'}</span></div>`;
  return `<div class="rcard"><h2>${single ? 'Results' : esc(s.full)}<span class="pill ${cls}">${lab}</span></h2>${inner}</div>`;
}

async function pageRecord() {
  $('#app').innerHTML = '<div class="loading">Loading…</div>';
  const ids = ORDER.filter(id => !['nba', 'soccer', 'golf'].includes(id));
  const ds = await Promise.all(ids.map(id => sportData(id).catch(() => ({ records: [] }))));
  $('#app').innerHTML = `
    <div class="phead"><div><h1>Track record</h1><div class="sub">Every graded result, wins and losses, by sport and market. Units are flat 1-unit plays.</div></div></div>
    <div class="banner off"><span>Records come straight from each model's own logs, so they start at different dates and use slightly different rules. Each row says how it was counted. Sample sports (NBA, soccer) never count.</span></div>
    <div class="rgrid">${ids.map((id, i) => recordCard(sportOf(id), ds[i])).join('')}</div>`;
}

function pageMethod() {
  $('#app').innerHTML = `<div class="prose">
  <div class="phead"><div><h1>Methodology</h1><div class="sub">How each model works, in plain language</div></div></div>
  <h2>How to read a play</h2>
  <p><b>Model</b> is the model's own number: a projected spread, total, stat line or probability. <b>Edge</b> is how far that is from the sportsbook's line. For spreads and totals it's in points; for props it's the model's expected value at the listed price. <b>Grade</b> sorts official plays by how well that kind of play has done in testing: A is the strongest group. A <b>model lean</b> is a gap the model sees that hasn't earned official status, usually because it hasn't been profitable in testing.</p>
  <p>Every model is a simplification. Lines move, injuries happen, and even a good edge loses often. That's why every record on this site shows losses and ROI, not just wins.</p>
  <div class="card"><h2>College football</h2>
    <p><b>Spreads:</b> opponent-adjusted team ratings that start from a preseason prior and shift toward in-season per-play efficiency, with recent games weighted more and starting-QB availability built in. The Bet Card is the set of spreads past the model's confidence cutoffs; spreads of 20+ points are left off.</p>
    <p><b>Totals:</b> scoring form, last season's ratings, per-play efficiency, pace and weather. Only the over/under groups that tested profitable are official.</p>
    <p><b>Props:</b> player projections from usage (targets, routes, carry share) with injury adjustments when a teammate is out. Only prop groups that were profitable on past-season lines are official; the grade adds the opposing defense's matchup and whether the line has moved since the model flagged it.</p></div>
  <div class="card"><h2>College basketball</h2>
    <p>Elo plus adjusted offensive and defensive efficiency, the four factors, tempo, rest and home court. Official rules come from a walk-forward backtest of the 2024–2027 seasons: spreads need a 10+ point edge for an A, totals are unders only, and moneylines are never official because the model's win percentages ran high in testing. Big edges against the <i>opening</i> line made money; edges against the close did not, so plays are flagged early.</p></div>
  <div class="card"><h2>NFL</h2>
    <p><b>Spreads and totals:</b> opponent-adjusted power ratings with ridge regression for margin and total. The total is anchored to the market because the model found no signal that beats it alone. Spread gaps are shown as model leans only: the logged record against the spread is below break-even.</p>
    <p><b>Anytime touchdown:</b> a logistic model on snap share, red-zone targets, inside-5 carries and team implied total, tested on held-out 2024 data. Only players who pass its qualification rules are official.</p></div>
  <div class="card"><h2>Golf</h2>
    <p>Player projections run through a Monte Carlo tournament simulation for win, top-5, top-10 and top-20 odds, head-to-head matchups and round scores, with course fit and live weather. Market odds are compared after removing the bookmaker's margin.</p></div>
  <div class="card"><h2>NBA and soccer</h2>
    <p>Not live yet. NBA will be built from the college basketball engine. Soccer will use the Dixon-Coles expected-goals engine used for the 2026 World Cup. Their pages show sample data until each model passes a backtest.</p></div>
  </div>`;
}

function pageAbout() {
  $('#app').innerHTML = `<div class="prose">
  <div class="phead"><div><h1>About PitchEdge</h1></div></div>
  <p>PitchEdge is an independent sports analytics research project. It publishes what a set of statistical models think about upcoming games, and how those models have actually performed, wins and losses included.</p>
  <h2>What this is not</h2>
  <p>This is not betting advice, a tipping service or a sportsbook. Nothing here is sold, and no plays are guaranteed. Model numbers are estimates and are often wrong. Check the law where you live before betting on anything.</p>
  <h2>Play responsibly</h2>
  <p>You must be 21 or older to bet in most US states. Set limits and never bet more than you can afford to lose. If gambling stops being fun, help is free and confidential: call or text <a href="tel:18004264537">1-800-GAMBLER</a>.</p>
  <h2>Data</h2>
  <p>Game data from CollegeFootballData.com, CollegeBasketballData.com and nflverse. Odds via The Odds API and OddsPapi. Golf projections from DataGolf. Some college football player data from PFF.</p>
  </div>`;
}

/* ============ shell ============ */
function renderSportbar(active) {
  $('#sportbar').innerHTML = ORDER.map(id => {
    const s = sportOf(id);
    const [, cls] = sportStatus(s);
    const n = (TODAY.plays || []).filter(p => p.sport === id && p.official && visible(p)).length;
    return `<a href="#/s/${id}" class="${active === id ? 'on' : ''}"><span class="dot ${cls}"></span>${esc(s.name)}${n ? `<span class="ct num">${n}</span>` : ''}</a>`;
  }).join('');
}

async function route(scroll) {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const page = parts[0] || 'today';
  document.querySelectorAll('#mainnav a').forEach(a => a.classList.toggle('on', a.dataset.nav === (page === 's' ? '' : page)));
  renderSportbar(page === 's' ? parts[1] : null);
  if (scroll === true) window.scrollTo(0, 0);
  if (page === 's' && parts[1]) return pageSport(parts[1], parts[2]);
  if (page === 'record') return pageRecord();
  if (page === 'method') return pageMethod();
  if (page === 'about') return pageAbout();
  return pageToday();
}

document.addEventListener('click', e => {
  const b = e.target.closest('.seg button');
  if (!b) return;
  F[b.parentElement.dataset.f] = b.dataset.v;
  route();
});
document.addEventListener('change', e => {
  const t = e.target;
  if (!t.dataset.f) return;
  F[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
  route();
});
window.addEventListener('hashchange', () => route(true));

async function boot() {
  try { TODAY = await getJSON('data/today.json'); }
  catch (e) { $('#app').innerHTML = '<div class="empty">Couldn\'t load the model data. Try again in a minute.</div>'; return; }
  $('#foot-sub').textContent = 'Data built ' + fmtWhen(TODAY.generated_at) + ' Arizona time.';
  route();
}
boot();
setInterval(async () => { try { TODAY = await getJSON('data/today.json'); for (const k in CACHE) delete CACHE[k]; route(); } catch (e) {} }, 15 * 60 * 1000);
