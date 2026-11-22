/* Revision Pulse — tick off question-bank + OSCE revision and see if you're on target for finals.
   Everything is stored on the phone (localStorage). No accounts, no server. */
(() => {
'use strict';

// ---------- Small helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clampInt = (v, lo, hi, fallback) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? clamp(n, lo, hi) : fallback; };
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const nf = new Intl.NumberFormat('en-GB');
const num = n => nf.format(Math.round(n));
const plural = (n, one, many) => `${num(n)} ${Math.abs(n) === 1 ? one : many}`;
const short = v => v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(Math.round(v));

// ---------- Dates (local time, keyed as YYYY-MM-DD so string comparison works) ----------
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const isKey = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && !isNaN(parseKey(k));
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const diffDays = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5);
const fmt = (k, opts) => parseKey(k).toLocaleDateString('en-GB', opts);
const fmtShort = k => fmt(k, { day: 'numeric', month: 'short' });
const fmtLong = k => fmt(k, { weekday: 'long', day: 'numeric', month: 'long' });
// ?today=YYYY-MM-DD lets you preview the app on another date (handy for testing).
// ?demo opens a sandbox with made-up history (stored separately, real data untouched), pretending it's 20 Dec.
const PARAMS = new URLSearchParams(location.search);
const DEMO = PARAMS.has('demo');
const DEMO_TODAY = '2026-12-20';
const DEBUG_TODAY = isKey(PARAMS.get('today')) ? PARAMS.get('today') : DEMO ? DEMO_TODAY : null;
const todayKey = () => DEBUG_TODAY || keyOf(new Date());

// ---------- Default content ----------
const STATION_GROUPS = [
  ['Examinations', ['Cardiovascular', 'Respiratory', 'Abdominal', 'Cranial nerves', 'Upper limb neuro', 'Lower limb neuro', 'Thyroid & neck', 'Hip & knee', 'Shoulder & hand', 'Spine']],
  ['Histories', ['Chest pain', 'Breathlessness', 'Abdominal pain', 'Headache', 'Collapse / syncope', 'Low mood & risk', 'Paediatric', 'Obs & gynae']],
  ['Communication', ['Breaking bad news', 'Consent for a procedure', 'Angry or upset patient', 'Medication counselling', 'SBAR handover']],
  ['Practical skills', ['Venepuncture', 'Cannulation', 'Blood cultures', 'ABG sampling', 'Catheterisation', 'IV drugs & fluids', 'Suturing', '12-lead ECG']],
  ['Data & prescribing', ['ECG interpretation', 'Chest X-ray', 'ABG interpretation', 'Drug chart', 'Fluid prescribing']],
  ['Acute care', ['A–E assessment', 'BLS / ALS']],
];
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const defaultStations = () => STATION_GROUPS.flatMap(([cat, names]) => names.map(name => ({ id: slug(`${cat}-${name}`), name, cat })));

const LIMITS = { qPlacement: [0, 400], qRevision: [0, 400], oPlacement: [0, 20], oRevision: [0, 20], coverageGoal: [1, 10] };

function defaultSettings() {
  return {
    name: '',
    start: todayKey(),           // plan starts the day the app is first opened
    placementEnd: '2026-12-13',  // last day of placement (3 weeks from 23 Nov)
    exam: '2027-01-25',          // finals start (Monday of exam week)
    qPlacement: 50, qRevision: 125,
    oPlacement: 1, oRevision: 3,
    coverageGoal: 3,
  };
}
const defaultState = () => ({ v: 1, onboarded: false, settings: defaultSettings(), logs: {}, stations: defaultStations(), topics: {}, installDismissed: false });

// ---------- UKMLA topics (data in topics.js) ----------
const RATINGS = [null, { emoji: '😬', label: 'Shaky' }, { emoji: '🙂', label: 'OK' }, { emoji: '💪', label: 'Confident' }];
const fold = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const topicSlug = s => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 70);
const TOPIC_GROUPS = (window.UKMLA || []).map(([name, emoji, items]) => ({
  id: topicSlug(name), name, emoji,
  items: items.map(full => {
    const m = full.match(/^(.*?)\s*\((including [^()]*)\)$/); // long "(including …)" lists become small detail text
    return { id: topicSlug(full), full, search: fold(full), name: m ? m[1] : full, detail: m ? m[2] : '' };
  }),
}));
const TOPIC_IDS = new Set(TOPIC_GROUPS.flatMap(g => g.items.map(it => it.id)));

// ---------- Storage ----------
const STORE_KEY = DEMO ? 'revisionPulse.demo' : 'revisionPulse.v1';

function normalise(raw) {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const settings = { ...d.settings, ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) };
  for (const k of ['start', 'placementEnd', 'exam']) if (!isKey(settings[k])) settings[k] = d.settings[k];
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) settings[k] = clampInt(settings[k], lo, hi, d.settings[k]);
  settings.name = typeof settings.name === 'string' ? settings.name.slice(0, 40) : '';
  const logs = {};
  if (raw.logs && typeof raw.logs === 'object') {
    for (const [k, v] of Object.entries(raw.logs)) {
      if (!isKey(k) || !v || typeof v !== 'object') continue;
      logs[k] = { q: clampInt(v.q, 0, 5000, 0), osce: Array.isArray(v.osce) ? [...new Set(v.osce.filter(x => typeof x === 'string'))] : [], rest: !!v.rest };
    }
  }
  const stations = Array.isArray(raw.stations)
    ? raw.stations.filter(x => x && typeof x.id === 'string' && typeof x.name === 'string')
        .map(x => ({ id: x.id, name: x.name.slice(0, 60), cat: typeof x.cat === 'string' && x.cat ? x.cat.slice(0, 40) : 'Other' }))
    : d.stations;
  const topics = {};
  if (raw.topics && typeof raw.topics === 'object') {
    for (const [k, v] of Object.entries(raw.topics)) if (k.length <= 100 && v && [1, 2, 3].includes(v.r)) topics[k] = { r: v.r, d: isKey(v.d) ? v.d : null };
  }
  return { v: 1, onboarded: !!raw.onboarded, settings, logs, stations, topics, installDismissed: !!raw.installDismissed };
}

function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return normalise(JSON.parse(raw)); } catch (e) { /* fall through */ }
  return DEMO ? demoState() : defaultState();
}

// Four weeks of believable made-up progress: placement then a week of revision break,
// one missed day, one rest day, Christmas Day planned off, and today half done.
function demoState() {
  const st = defaultState();
  st.onboarded = true;
  st.settings = { ...st.settings, name: 'Sam', start: '2026-11-23', placementEnd: '2026-12-13', exam: '2027-01-25' };
  const ids = st.stations.map(x => x.id);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const today = todayKey();
  for (let k = st.settings.start; k < today && k < st.settings.exam; k = addDays(k, 1)) {
    if (k === '2026-12-06') { st.logs[k] = { q: 0, osce: [], rest: true }; continue; }
    if (k === '2026-12-02') continue; // a missed day happens to everyone
    const placement = k <= st.settings.placementEnd;
    const q = placement ? Math.round((32 + rnd() * 50) / 5) * 5 : Math.round((115 + rnd() * 40) / 5) * 5;
    const n = placement ? Math.floor(rnd() * 2.4) : 1 + Math.floor(rnd() * 3);
    const osce = [];
    while (osce.length < n) { const id = ids[Math.floor(rnd() * ids.length)]; if (!osce.includes(id)) osce.push(id); }
    st.logs[k] = { q, osce, rest: false };
  }
  st.logs['2026-12-25'] = { q: 0, osce: [], rest: true };
  if (today < st.settings.exam) st.logs[today] = { q: 60, osce: [ids[1]], rest: false };
  const weak = ['eye', 'kidneys-and-urinary-tract'];
  for (const g of TOPIC_GROUPS) for (const it of g.items) {
    const isWeak = weak.includes(g.id);
    if (rnd() < (isWeak ? 0.5 : 0.33)) {
      const y = rnd();
      st.topics[it.id] = { r: isWeak ? (y < 0.6 ? 1 : 2) : (y < 0.12 ? 1 : y < 0.5 ? 2 : 3), d: addDays(today, -Math.floor(rnd() * 12)) };
    }
  }
  return st;
}
let state = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Couldn’t save — is storage blocked?'); }
}

const emptyLog = () => ({ q: 0, osce: [], rest: false });
const getLog = k => state.logs[k] || emptyLog();
function setLog(k, patch) {
  const next = { ...getLog(k), ...patch };
  if (!next.q && !next.osce.length && !next.rest) delete state.logs[k]; else state.logs[k] = next;
  save();
}

// ---------- The plan maths ----------
// Each plan day has a question + OSCE target based on phase (placement vs revision break).
// Rest days have a target of zero. The "plan line" is the running total of targets.
function phaseTargets(key, s = state.settings) {
  return key <= s.placementEnd
    ? { q: s.qPlacement, o: s.oPlacement, phase: 'placement' }
    : { q: s.qRevision, o: s.oRevision, phase: 'revision' };
}
function dayTargets(key) {
  const t = phaseTargets(key);
  return getLog(key).rest ? { ...t, q: 0, o: 0 } : t;
}

function buildPlan() {
  const s = state.settings, today = todayKey();
  const last = addDays(s.exam, -1); // last revision day = day before finals
  const n = Math.max(0, diffDays(s.start, last) + 1);
  const days = [];
  let cumQT = 0, cumOT = 0, cumQ = 0, cumO = 0;
  for (let i = 0; i < n; i++) {
    const key = addDays(s.start, i);
    const log = getLog(key);
    const t = phaseTargets(key, s);
    const qTarget = log.rest ? 0 : t.q, oTarget = log.rest ? 0 : t.o;
    const q = log.q, o = log.osce.length;
    cumQT += qTarget; cumOT += oTarget;
    const counted = key <= today;
    if (counted) { cumQ += q; cumO += o; }
    days.push({
      key, i, phase: t.phase, rest: log.rest, qTarget, oTarget, q, o, cumQT, cumOT,
      cumQ: counted ? cumQ : null, cumO: counted ? cumO : null,
      past: key < today, isToday: key === today, future: key > today,
    });
  }
  const p = { days, today, n, last, goalQ: cumQT, goalO: cumOT };
  p.q = balanceFor(p, 'q');
  p.o = balanceFor(p, 'o');
  return p;
}

// Balance = how far ahead (+) or behind (−) the plan line you are.
// Today is treated kindly: being under today's target doesn't count against you until the day is over,
// but going over it counts as being ahead straight away.
function balanceFor(p, kind) {
  const T = `${kind}Target`;
  let doneBefore = 0, targetBefore = 0, todayDone = 0, todayTarget = 0, upcoming = 0;
  for (const d of p.days) {
    if (d.past) { doneBefore += d[kind]; targetBefore += d[T]; }
    else {
      if (d.isToday) { todayDone = d[kind]; todayTarget = d[T]; }
      if (d[T] > 0) upcoming++;
    }
  }
  const balance = doneBefore - targetBefore + Math.max(0, todayDone - todayTarget);
  const done = doneBefore + todayDone;
  return { balance, done, pace: done - balance, todayDone, todayTarget, upcoming };
}

function vitals(p, kind) {
  const b = p[kind], s = state.settings;
  const units = kind === 'q' ? ['question', 'questions'] : ['station', 'stations'];
  if (!p.n) return { tone: 'info', emoji: '⚙️', title: 'Set your dates', text: 'Add your finals date in Settings to build your plan.' };
  if (p.today < s.start) return { tone: 'info', emoji: '⏳', title: 'Plan not started', text: `Your plan kicks off on ${fmtShort(s.start)}.` };
  if (p.today > p.last) {
    const goal = kind === 'q' ? p.goalQ : p.goalO;
    return { tone: 'ok', emoji: '🎓', title: `${plural(b.done, ...units)} done`, text: b.done >= goal ? 'You completed your whole plan. Incredible work.' : 'Look how far you came. Go get them.' };
  }
  const daily = Math.max(1, phaseTargets(p.today)[kind]);
  const B = b.balance;
  if (B > 0) {
    const d = B / daily;
    return { tone: 'ok', emoji: '💚', title: `${plural(B, ...units)} ahead`, text: d >= 1 ? `About ${d.toFixed(1).replace(/\.0$/, '')} ${d >= 1.05 ? 'days' : 'day'} of buffer banked. Lovely.` : 'A little buffer in the bank. Keep that rhythm going.' };
  }
  if (B === 0) {
    const left = b.todayTarget - b.todayDone;
    return { tone: 'ok', emoji: '💚', title: 'On target', text: left > 0 ? `Bang on the line. ${num(left)} more today keeps it that way.` : 'Bang on the line — steady as sinus rhythm.' };
  }
  const behind = -B;
  if (behind <= daily) return { tone: 'near', emoji: '💛', title: `${num(behind)} to catch up`, text: 'Less than a day’s worth — one good session and you’re back on the line.' };
  const spread = clamp(b.upcoming, 1, 7);
  const extra = Math.ceil(behind / spread);
  return { tone: 'catch', emoji: '🧡', title: `${num(behind)} to catch up`, text: `Very doable: about ${num(extra)} extra a day for ${plural(spread, 'day', 'days')} puts you back on the line.` };
}

function phaseInfo(p) {
  const s = state.settings, t = p.today;
  if (!p.n) return { icon: '⚙️', text: 'Set your dates in Settings' };
  if (t < s.start) return { icon: '⏳', text: `Plan starts ${fmtShort(s.start)}` };
  if (t >= s.exam) return { icon: '🎓', text: 'Finals — you’ve got this' };
  if (t <= s.placementEnd) {
    const left = diffDays(t, s.placementEnd);
    return { icon: '🏥', text: left === 0 ? 'Last day of placement!' : `Placement · break in ${plural(left + 1, 'day', 'days')}` };
  }
  const revStart = s.placementEnd >= s.start ? addDays(s.placementEnd, 1) : s.start;
  return { icon: '📚', text: `Revision break · day ${diffDays(revStart, t) + 1} of ${diffDays(revStart, p.last) + 1}` };
}

function stationCounts() {
  const c = {};
  for (const log of Object.values(state.logs)) for (const id of log.osce) c[id] = (c[id] || 0) + 1;
  return c;
}
// ----- OSCE suggestions: spaced practice -----
// After a station's 1st practice it's due again in ~2 days, after the 2nd in 4, the 3rd in 7, then every 10.
const REVIEW_GAPS = [2, 4, 7, 10];
function stationHistory(upTo) {
  const h = {};
  for (const [k, log] of Object.entries(state.logs)) {
    if (k > upTo) continue;
    for (const id of log.osce) {
      const e = h[id] || (h[id] = { count: 0, last: null });
      e.count++;
      if (!e.last || k > e.last) e.last = k;
    }
  }
  return h;
}
function stationDue(e, day) {
  const ago = Math.max(1, diffDays(e.last, day));
  return { ago, due: ago / REVIEW_GAPS[Math.min(e.count, REVIEW_GAPS.length) - 1] };
}
// Picks today's suggestions: the station most overdue for a refresh (if any is due), then stations never
// tried yet, then whatever was practised longest ago. Spread across groups where possible; ties shuffle daily.
function suggestStations(day, n = 3) {
  const hist = stationHistory(day), ticked = new Set(getLog(day).osce);
  const seed = Number(day.replace(/-/g, ''));
  const hash = id => { let h = seed; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 100003; return h; };
  const fresh = [], review = [];
  for (const st of state.stations) {
    if (ticked.has(st.id)) continue;
    const e = hist[st.id];
    if (!e) { fresh.push({ st, note: 'new' }); continue; }
    const { ago, due } = stationDue(e, day);
    review.push({ st, due, note: ago === 1 ? 'yesterday' : `${ago} days ago` });
  }
  fresh.sort((a, b) => hash(a.st.id) - hash(b.st.id));
  review.sort((a, b) => b.due - a.due || hash(a.st.id) - hash(b.st.id));
  const first = review.length && review[0].due >= 1 ? [review.shift()] : [];
  const tier1 = [...first, ...fresh, ...review.filter(r => r.due >= 1)];
  const tier2 = review.filter(r => r.due < 1);
  const picks = [], cats = new Set();
  for (const c of tier1) if (picks.length < n && !cats.has(c.st.cat)) { picks.push(c); cats.add(c.st.cat); }
  for (const c of [...tier1, ...tier2]) if (picks.length < n && !picks.includes(c)) picks.push(c);
  return picks;
}
const stationName = id => (state.stations.find(s => s.id === id) || {}).name || 'Removed station';
const categories = () => [...new Set(state.stations.map(s => s.cat))];

function streak() {
  const active = k => { const l = getLog(k); return l.rest || l.q > 0 || l.osce.length > 0; };
  let k = todayKey(), n = 0;
  if (!active(k)) k = addDays(k, -1);
  while (active(k) && n < 2000) { n++; k = addDays(k, -1); }
  return n;
}

// ---------- UI state ----------
const ui = { chart: 'q', osceEdit: false, pop: false, ringFrom: null, topicSort: 'gmc', topicQuery: '', showAllShaky: false };
let sheet = null; // { type, date, back, fresh }
const TABS = ['today', 'journey', 'topics', 'osce', 'settings'];
const currentTab = () => { const h = location.hash.slice(1); return TABS.includes(h) ? h : 'today'; };

const Q_DONE = ['Daily dose complete 💊', 'Target smashed! 🎯', 'Questions done — big brain energy 🧠', 'That’s the dose. Go hydrate 💧', 'Done! Future you says thanks 🙌'];
const O_DONE = ['OSCE stations done 🩺', 'The examiner is impressed 👏', 'Stations ticked — steady hands ✋'];
const BOTH = ['Everything done today — go do something nice ☕', 'Full house today! Rest is revision too 💜', 'All done. Proud of you 🌟'];

// ---------- Views ----------
function hero({ eyebrow, title, right = '', chips = '' }) {
  return `<header class="hero">
    <div class="hero-row">
      <div class="hero-text">${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h1>${title}</h1></div>
      ${right}
    </div>
    ${chips ? `<div class="hero-chips">${chips}</div>` : ''}
  </header>`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function ring(done, target, rest) {
  const r = 52, C = 2 * Math.PI * r;
  const prog = target > 0 ? Math.min(done / target, 1) : (done > 0 ? 1 : 0);
  const from = ui.ringFrom == null ? prog : ui.ringFrom;
  ui.ringFrom = null;
  const over = target > 0 && done > target ? done - target : 0;
  return `<button class="ring-wrap" data-action="openNumber" data-date="${todayKey()}" aria-label="${done} questions done today. Tap to type an exact number">
    <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
      <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--brand)"/><stop offset="1" style="stop-color:var(--brand-2)"/></linearGradient></defs>
      <circle class="bg" cx="60" cy="60" r="${r}"/>
      <circle class="fg ${prog >= 1 ? 'full' : ''}" cx="60" cy="60" r="${r}" stroke-dasharray="${C.toFixed(2)}"
        style="--from:${(C * (1 - from)).toFixed(2)};--to:${(C * (1 - prog)).toFixed(2)};stroke-dashoffset:${(C * (1 - prog)).toFixed(2)}"/>
    </svg>
    <span class="ring-label">
      <span class="big ${ui.pop ? 'pop' : ''}">${num(done)}</span>
      <span class="sub">${rest ? 'rest day 🛌' : target > 0 ? `of ${num(target)}` : 'no target today'}</span>
      ${over ? `<span class="bonus">⭐ +${num(over)} bonus</span>` : prog >= 1 && target > 0 ? '<span class="bonus">✅ done!</span>' : ''}
    </span>
  </button>`;
}

function pips(done, target) {
  if (target <= 0) return '';
  let h = '';
  for (let i = 0; i < Math.min(target, 10); i++) h += `<i class="pip ${i < done ? 'on' : ''}"></i>`;
  if (done > target) h += `<span class="pip-extra">+${done - target}</span>`;
  return `<span class="pips">${h}</span>`;
}

function installHint() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (!ios || standalone || state.installDismissed) return '';
  return `<section class="card install">
    <div class="install-icon">📲</div>
    <div><b>Put me on your Home Screen</b><p>Tap <span class="share-ico" aria-label="Share">⬆︎</span> Share, then <b>Add to Home Screen</b>. I’ll open like a normal app and work offline.</p></div>
    <button class="x" data-action="dismissInstall" aria-label="Dismiss">✕</button>
  </section>`;
}

function viewToday(p) {
  const t = p.today, s = state.settings, log = getLog(t), tg = dayTargets(t);
  const ph = phaseInfo(p), v = vitals(p, 'q');
  const toGo = diffDays(t, s.exam);
  const ticked = log.osce;

  const countdown = toGo > 0
    ? `<div class="countdown"><b>${toGo}</b><span>${toGo === 1 ? 'day' : 'days'} to<br>finals</span></div>`
    : toGo === 0 ? '<div class="countdown"><b>🎓</b><span>finals<br>today!</span></div>' : '';

  const suggestions = suggestStations(t);

  const oTarget = tg.o, oDone = ticked.length;
  return `
  ${hero({
    eyebrow: `${greeting()}${s.name ? `, ${esc(s.name)}` : ''} 👋`,
    title: fmtLong(t),
    right: countdown,
    chips: `<span class="chip">${ph.icon} ${ph.text}</span><button class="chip status ${v.tone}" data-action="tab" data-tab="journey">${v.emoji} ${v.title}</button>`,
  })}
  ${installHint()}
  <section class="card">
    <div class="card-head"><h2>Question bank</h2><span class="tag">${tg.phase === 'placement' ? 'Placement dose' : 'Today’s dose'}</span></div>
    ${ring(log.q, tg.q, log.rest)}
    <div class="qbtns">
      <button class="btn ghost" data-action="addQ" data-n="-10" aria-label="Remove 10">−10</button>
      <button class="btn primary" data-action="addQ" data-n="10">+10</button>
      <button class="btn primary" data-action="addQ" data-n="25">+25</button>
      <button class="btn primary" data-action="addQ" data-n="50">+50</button>
    </div>
    <p class="hint">Tap the number to type an exact amount</p>
  </section>

  <section class="card">
    <div class="card-head"><h2>OSCE stations</h2>${oTarget > 0 ? `<span class="count">${oDone} / ${oTarget}</span>` : '<span class="tag">Bonus</span>'}</div>
    ${pips(oDone, oTarget)}
    ${ticked.length ? `<div class="chips">${ticked.map(id => `<button class="schip on" data-action="toggleStation" data-id="${esc(id)}" data-date="${t}">✓ ${esc(stationName(id))}</button>`).join('')}</div>`
      : `<p class="muted small">${tg.phase === 'placement' ? 'Ward time counts! Tick any station you practised today.' : 'Tick each station as you practise it.'}</p>`}
    ${suggestions.length ? `<p class="mini-label">Suggested next — one tap to tick</p><div class="chips">${suggestions.map(({ st, note }) => `<button class="schip" data-action="toggleStation" data-id="${esc(st.id)}" data-date="${t}">＋ ${esc(st.name)} <small>${note === 'new' ? '✨ new' : `🔁 ${note}`}</small></button>`).join('')}</div>` : ''}
    <button class="btn wide soft" data-action="openStations" data-date="${t}">Tick a station</button>
  </section>

  ${topicsCard()}

  ${raceCard(p)}

  <div class="center"><button class="link-btn" data-action="toggleRest" data-date="${t}">${log.rest ? 'Cancel rest day' : 'Need a rest day? 🛌'}</button></div>
  `;
}

function raceCard(p) {
  if (!p.n) return '';
  const b = p.q, goal = Math.max(1, p.goalQ);
  const me = clamp(b.done / goal, 0, 1), pacer = clamp(b.pace / goal, 0, 1);
  const v = vitals(p, 'q');
  const runner = (x, emoji, cls) => `<span class="runner ${cls}" style="left:${(x * 100).toFixed(2)}%;transform:translateX(-${(x * 100).toFixed(2)}%)">${emoji}</span>`;
  return `<section class="card">
    <div class="card-head"><h2>Race the tortoise</h2><span class="tag">${Math.floor(me * 100)}% of plan</span></div>
    <div class="track">
      <div class="lane"><div class="lane-fill me" style="width:${(me * 100).toFixed(2)}%"></div>${runner(me, '🧑‍⚕️', 'me')}</div>
      <div class="lane"><div class="lane-fill pacer" style="width:${(pacer * 100).toFixed(2)}%"></div>${runner(pacer, '<span class="flip">🐢</span>', 'pacer')}</div>
      <span class="finish">🏁</span>
    </div>
    <div class="race-legend"><span>🧑‍⚕️ You <b>${num(b.done)}</b></span><span>🐢 Plan <b>${num(b.pace)}</b></span><span>🎓 Goal <b>${num(p.goalQ)}</b></span></div>
    <p class="race-note ${v.tone}">${v.emoji} ${v.text}</p>
  </section>`;
}

function viewJourney(p) {
  const s = state.settings;
  const vq = vitals(p, 'q'), vo = vitals(p, 'o');
  let sum7 = 0;
  for (let i = 0; i < 7; i++) sum7 += getLog(addDays(p.today, -i)).q;
  let best = 0, bestKey = null;
  for (const [k, l] of Object.entries(state.logs)) if (l.q > best) { best = l.q; bestKey = k; }
  const st = streak();
  const pct = p.goalQ ? Math.min(100, Math.floor((p.q.done / p.goalQ) * 100)) : 0;

  const vRow = (v, label) => `<div class="vital ${v.tone}"><div class="vital-emoji">${v.emoji}</div><div><div class="vital-label">${label}</div><div class="vital-title">${v.title}</div><div class="vital-text">${v.text}</div></div></div>`;

  return `
  ${hero({ eyebrow: 'Your journey', title: p.n ? `${fmtShort(s.start)} → ${fmtShort(s.exam)}` : 'Set your dates', chips: `<span class="chip">🔥 ${st ? `${num(st)}-day streak` : 'Start a streak today'}</span><span class="chip">📅 ${plural(Math.max(0, diffDays(p.today, s.exam)), 'day', 'days')} to go</span>` })}
  <section class="card">
    <div class="card-head"><h2>Vitals check</h2></div>
    ${vRow(vq, 'Question bank')}
    ${vRow(vo, 'OSCE stations')}
  </section>

  <section class="card">
    <div class="card-head"><h2>Progress line</h2>
      <div class="seg" role="tablist">
        <button class="${ui.chart === 'q' ? 'on' : ''}" data-action="chart" data-kind="q">Questions</button>
        <button class="${ui.chart === 'o' ? 'on' : ''}" data-action="chart" data-kind="o">OSCE</button>
      </div>
    </div>
    ${chartSVG(p, ui.chart)}
    <div class="legend"><span><i class="lg-line"></i>You</span><span><i class="lg-dash"></i>Plan (on target)</span><span><i class="lg-band"></i>Placement</span></div>
    <p class="muted small">Stay on or above the dashed line and you’ll finish on time.</p>
  </section>

  <section class="stats">
    <div class="stat"><b>${num(p.q.done)}</b><span>questions done</span><em>${pct}% of ${num(p.goalQ)}</em></div>
    <div class="stat"><b>${num(Math.round(sum7 / 7))}</b><span>a day, last 7 days</span><em>plan: ${num(phaseTargets(p.today).q)}/day now</em></div>
    <div class="stat"><b>${num(p.o.done)}</b><span>OSCE stations</span><em>of ${num(p.goalO)} planned</em></div>
    <div class="stat"><b>${num(best)}</b><span>best day</span><em>${bestKey ? fmtShort(bestKey) : 'still to come'}</em></div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Calendar</h2><span class="tag">Tap a day to edit</span></div>
    ${calendar(p)}
    <div class="legend cal-legend"><span><i class="sw l0"></i>Nothing</span><span><i class="sw l1"></i>Some</span><span><i class="sw l3"></i>Target hit</span><span>🛌 Rest</span><span><i class="lg-dot"></i>OSCE</span></div>
  </section>`;
}

function chartSVG(p, kind) {
  const days = p.days, n = days.length;
  if (!n) return '<p class="muted">Set your dates in Settings to see your plan.</p>';
  const W = 340, H = 220, L = 34, R = 12, T = 24, B = 26;
  const tKey = kind === 'q' ? 'cumQT' : 'cumOT', aKey = kind === 'q' ? 'cumQ' : 'cumO';
  const goal = kind === 'q' ? p.goalQ : p.goalO;
  let maxA = 0;
  for (const d of days) if (d[aKey] != null) maxA = Math.max(maxA, d[aKey]);
  const yMax = Math.max(goal, maxA, 1) * 1.22;
  const X = j => L + (j / n) * (W - L - R);
  const Y = v => T + (1 - v / yMax) * (H - T - B);
  const path = pts => pts.map(([j, v], i) => `${i ? 'L' : 'M'}${X(j).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const plan = [[0, 0], ...days.map((d, i) => [i + 1, d[tKey]])];
  const act = [[0, 0]];
  days.forEach((d, i) => { if (d[aKey] != null) act.push([i + 1, d[aKey]]); });
  const plc = days.filter(d => d.phase === 'placement').length;
  const tIdx = days.findIndex(d => d.isToday);
  const v = vitals(p, kind);

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress line: ${esc(v.title)}">
    <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--brand);stop-opacity:.32"/><stop offset="1" style="stop-color:var(--brand);stop-opacity:0"/></linearGradient></defs>`;
  if (plc) {
    svg += `<rect class="band" x="${X(0)}" y="${T}" width="${(X(plc) - X(0)).toFixed(1)}" height="${H - T - B}" rx="6"/>`;
    if (X(plc) - X(0) > 60) svg += `<text class="band-label" x="${((X(0) + X(plc)) / 2).toFixed(1)}" y="${T + 13}" text-anchor="middle">🏥 Placement</text>`;
  }
  if (plc < n && X(n) - X(plc) > 80) svg += `<text class="band-label" x="${((X(plc) + X(n)) / 2).toFixed(1)}" y="${T + 13}" text-anchor="middle">📚 Revision break</text>`;
  for (const g of [0, goal / 2]) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(g).toFixed(1)}" y2="${Y(g).toFixed(1)}"/><text class="axis" x="${L - 5}" y="${(Y(g) + 3).toFixed(1)}" text-anchor="end">${short(g)}</text>`;
  svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(goal).toFixed(1)}" y2="${Y(goal).toFixed(1)}"/><text class="axis" x="${L - 5}" y="${(Y(goal) + 3).toFixed(1)}" text-anchor="end">${short(goal)}</text>`;
  if (tIdx >= 0) svg += `<line class="today-rule" x1="${X(tIdx + 1).toFixed(1)}" x2="${X(tIdx + 1).toFixed(1)}" y1="${T}" y2="${H - B}"/>`;
  svg += `<path class="plan" d="${path(plan)}"/>`;
  svg += `<text class="goal-label" x="${X(n) - 2}" y="${(Y(goal) - 6).toFixed(1)}" text-anchor="end">🎓 ${num(goal)}</text>`;
  if (act.length > 1) {
    const last = act[act.length - 1];
    svg += `<path class="area" d="${path(act)} L${X(last[0]).toFixed(1)} ${Y(0).toFixed(1)} L${X(0).toFixed(1)} ${Y(0).toFixed(1)} Z"/>`;
    svg += `<path class="actual" d="${path(act)}"/>`;
    const bal = p[kind].balance, cx = X(last[0]), cy = Y(last[1]);
    const label = bal > 0 ? `+${num(bal)} ahead` : bal < 0 ? `−${num(-bal)}` : 'on target';
    const bw = label.length * 6.4 + 16;
    const bx = clamp(cx - bw / 2, L, W - R - bw);
    let by = cy - 30; if (by < T - 20) by = cy + 10;
    svg += `<circle class="dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5"/>
      <g class="callout ${v.tone}"><rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="21" rx="10.5"/><text x="${(bx + bw / 2).toFixed(1)}" y="${(by + 14.5).toFixed(1)}" text-anchor="middle">${label}</text></g>`;
  }
  svg += `<text class="axis" x="${X(0)}" y="${H - 8}" text-anchor="start">${fmtShort(days[0].key)}</text>`;
  svg += `<text class="axis" x="${X(n)}" y="${H - 8}" text-anchor="end">Finals ${fmtShort(state.settings.exam)}</text>`;
  return svg + '</svg>';
}

function calendar(p) {
  if (!p.n) return '';
  const exam = state.settings.exam;
  const monIdx = k => (parseKey(k).getDay() + 6) % 7;
  const gridStart = addDays(p.days[0].key, -monIdx(p.days[0].key));
  const gridEnd = addDays(exam, 6 - monIdx(exam));
  const map = new Map(p.days.map(d => [d.key, d]));
  let h = `<div class="cal-head">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<span>${x}</span>`).join('')}</div><div class="cal-grid">`;
  for (let k = gridStart; k <= gridEnd; k = addDays(k, 1)) {
    const d = map.get(k), date = parseKey(k).getDate();
    const month = date === 1 || (d && d.i === 0) ? `<i class="m">${fmt(k, { month: 'short' })}</i>` : '';
    if (!d) {
      h += k === exam ? `<div class="cal-cell exam" title="Finals start">🎓</div>` : k > exam ? `<div class="cal-cell exam-week">${date}</div>` : '<div class="cal-cell blank"></div>';
      continue;
    }
    let cls = 'cal-cell', inner = String(date);
    if (d.rest) { cls += ' rest'; inner = '🛌'; }
    else if (d.future) cls += ' future';
    else {
      const r = d.qTarget > 0 ? d.q / d.qTarget : (d.q > 0 ? 1 : 0);
      cls += r >= 1 ? ' l3' : r >= 0.5 ? ' l2' : r > 0 ? ' l1' : d.isToday ? ' future' : ' l0';
    }
    if (d.isToday) cls += ' today';
    const star = !d.rest && !d.future && d.qTarget > 0 && d.q >= d.qTarget && d.o >= d.oTarget ? '<i class="star">★</i>' : '';
    const dot = d.o > 0 ? '<i class="odot"></i>' : '';
    h += `<button class="${cls}" data-action="openDay" data-date="${k}" aria-label="${fmtLong(k)}: ${d.q} questions, ${d.o} OSCE stations${d.rest ? ', rest day' : ''}">${month}${inner}${star}${dot}</button>`;
  }
  return h + '</div>';
}

// ---------- Topics ----------
function topicStats() {
  const groups = TOPIC_GROUPS.map(g => {
    const counts = [0, 0, 0, 0];
    let sum = 0;
    for (const it of g.items) { const r = (state.topics[it.id] || {}).r || 0; counts[r]++; sum += r; }
    const rated = g.items.length - counts[0];
    return { g, total: g.items.length, counts, rated, avg: rated ? sum / rated : null, readiness: sum / (3 * g.items.length) };
  });
  const all = [0, 0, 0, 0];
  for (const x of groups) x.counts.forEach((n, i) => { all[i] += n; });
  const total = groups.reduce((a, x) => a + x.total, 0);
  const today = todayKey();
  const todayCount = Object.entries(state.topics).filter(([k, v]) => v.d === today && TOPIC_IDS.has(k)).length;
  // Least confident = lowest average rating among areas she has started (ties: more shaky topics first).
  const leastConfident = groups.filter(x => x.rated && x.avg < 3)
    .sort((a, b) => a.avg - b.avg || b.counts[1] - a.counts[1] || a.rated - b.rated).slice(0, 2);
  return { groups, all, total, rated: total - all[0], todayCount, leastConfident };
}

function stackBar(counts, total, cls = '') {
  const seg = (n, k) => n ? `<i class="seg-${k}" style="width:${((n / total) * 100).toFixed(2)}%"></i>` : '';
  return `<span class="stack ${cls}" role="img" aria-label="${counts[3]} confident, ${counts[2]} OK, ${counts[1]} shaky, ${counts[0]} not yet">${seg(counts[3], 'c')}${seg(counts[2], 'o')}${seg(counts[1], 's')}</span>`;
}

function topicsCard() {
  if (!TOPIC_GROUPS.length) return '';
  const s = topicStats();
  const line = !s.rated ? 'Worked through a topic? Tap here to tick it off.'
    : s.leastConfident.length ? `😬 Least confident: ${s.leastConfident.map(x => `<b>${esc(x.g.name)}</b>`).join(' · ')}`
    : '💪 Confident in everything you’ve covered so far';
  return `<section class="card topics-card" data-action="tab" data-tab="topics" role="link" tabindex="0" aria-label="UKMLA topics: ${s.rated} of ${s.total} worked through">
    <div class="card-head"><h2>UKMLA topics</h2><span class="count">${num(s.rated)}<small> / ${num(s.total)}</small></span></div>
    ${stackBar(s.all, s.total)}
    <div class="topics-line"><span>${line}</span><span class="chev" aria-hidden="true">›</span></div>
  </section>`;
}

function topicRow(it, sub = '') {
  const r = (state.topics[it.id] || {}).r || 0;
  const detail = sub || it.detail;
  return `<div class="topic-row">
    <div class="topic-text"><div class="topic-name">${esc(it.name)}</div>${detail ? `<div class="topic-detail">${esc(detail)}</div>` : ''}</div>
    <div class="rate" role="group" aria-label="How confident are you with ${esc(it.name)}?">${[1, 2, 3].map(v =>
      `<button class="${r === v ? 'on' : ''}" data-action="rate" data-id="${it.id}" data-r="${v}" aria-pressed="${r === v}" aria-label="${RATINGS[v].label}">${RATINGS[v].emoji}</button>`).join('')}</div>
  </div>`;
}

function topicResultsHTML(q) {
  q = fold((q || '').trim());
  if (!q) return '';
  const res = [];
  for (const g of TOPIC_GROUPS) for (const it of g.items) if (it.search.includes(q)) res.push(topicRow(it, `${g.emoji} ${g.name}`));
  return `<section class="card results">${res.length
    ? res.slice(0, 40).join('') + (res.length > 40 ? `<p class="muted small more">…and ${res.length - 40} more — try a longer search.</p>` : '')
    : '<p class="muted small more">No topic matches that.</p>'}</section>`;
}

function viewTopics() {
  const s = topicStats();
  const order = ui.topicSort === 'needs'
    ? [...s.groups].sort((a, b) => a.readiness - b.readiness || a.g.name.localeCompare(b.g.name))
    : s.groups;
  const shaky = TOPIC_GROUPS.flatMap(g => g.items.filter(it => (state.topics[it.id] || {}).r === 1).map(it => ({ it, g })));
  const shown = ui.showAllShaky ? shaky : shaky.slice(0, 5);
  const areaRow = x => `<button class="area-row" data-action="openArea" data-id="${x.g.id}">
      <span class="area-emoji" aria-hidden="true">${x.g.emoji}</span>
      <span class="area-main"><span class="area-name">${esc(x.g.name)}</span>${stackBar(x.counts, x.total, 'thin')}</span>
      <span class="area-count">${x.rated}/${x.total}</span><span class="chev" aria-hidden="true">›</span></button>`;
  return `
  ${hero({ eyebrow: 'UKMLA content map', title: 'Topics', chips: `<span class="chip">✅ ${num(s.rated)} of ${num(s.total)} worked through</span>${s.todayCount ? `<span class="chip">✨ +${s.todayCount} today</span>` : ''}` })}
  <section class="card">
    ${stackBar(s.all, s.total, 'big')}
    <div class="legend"><span><i class="sw c"></i>💪 Confident ${s.all[3]}</span><span><i class="sw o"></i>🙂 OK ${s.all[2]}</span><span><i class="sw s"></i>😬 Shaky ${s.all[1]}</span><span><i class="sw n"></i>Not yet ${s.all[0]}</span></div>
    <p class="muted small">Worked through a topic, for example with Claude? Open its area and tap how confident you feel.</p>
  </section>
  <div class="search-wrap"><input id="topicSearch" type="search" placeholder="Search all ${s.total} topics" value="${esc(ui.topicQuery)}" autocomplete="off" enterkeyhint="search"></div>
  <div id="topicResults">${topicResultsHTML(ui.topicQuery)}</div>
  ${shaky.length ? `<section class="card">
    <div class="card-head"><h2>😬 Shaky topics</h2><span class="tag">${shaky.length} to revisit</span></div>
    ${shown.map(({ it, g }) => topicRow(it, `${g.emoji} ${g.name}`)).join('')}
    ${shaky.length > 5 ? `<button class="link-btn" data-action="toggleShaky">${ui.showAllShaky ? 'Show fewer' : `Show all ${shaky.length}`}</button>` : ''}
  </section>` : ''}
  <div class="areas-head"><h3>Areas</h3><div class="seg">
    <button class="${ui.topicSort !== 'needs' ? 'on' : ''}" data-action="topicSort" data-sort="gmc">GMC order</button>
    <button class="${ui.topicSort === 'needs' ? 'on' : ''}" data-action="topicSort" data-sort="needs">Needs work</button></div></div>
  <section class="card areas">${order.map(areaRow).join('')}</section>
  <p class="footer">Topics from the ${esc(window.UKMLA_SOURCE || 'GMC MLA content map')}.</p>`;
}

function viewOsce(p) {
  const counts = stationCounts(), goal = state.settings.coverageGoal, t = p.today;
  const hist = stationHistory(t);
  const ticked = new Set(getLog(t).osce);
  const total = state.stations.length;
  const atGoal = state.stations.filter(s => (counts[s.id] || 0) >= goal).length;
  const tried = state.stations.filter(s => (counts[s.id] || 0) > 0).length;
  const pct = total ? atGoal / total : 0;
  const r = 34, C = 2 * Math.PI * r;
  const tg = dayTargets(t);

  const tile = st => {
    const c = counts[st.id] || 0, on = ticked.has(st.id);
    const lvl = c >= goal ? 'gold' : c > 0 ? 'some' : '';
    const dots = Array.from({ length: Math.min(goal, 6) }, (_, i) => `<i class="pip ${i < c ? 'on' : ''}"></i>`).join('') + (c > goal ? `<span class="pip-extra">+${c - goal}</span>` : '');
    if (ui.osceEdit) return `<button class="tile edit" data-action="deleteStation" data-id="${esc(st.id)}"><span class="tile-name">${esc(st.name)}</span><span class="del">Remove</span></button>`;
    return `<button class="tile ${lvl} ${on ? 'on' : ''}" data-action="toggleStation" data-id="${esc(st.id)}" data-date="${t}" aria-pressed="${on}">
      <span class="tile-name">${esc(st.name)}</span><span class="pips">${dots}</span>${on ? '<span class="tick">✓ today</span>' : hist[st.id] && stationDue(hist[st.id], t).due >= 1 ? '<span class="due">🔁 due</span>' : ''}${c >= goal ? '<span class="medal">🏅</span>' : ''}</button>`;
  };

  return `
  ${hero({ eyebrow: 'OSCE stations', title: 'Tap to tick today', right: `<button class="hero-btn" data-action="osceEdit">${ui.osceEdit ? 'Done' : 'Edit'}</button>`, chips: `<span class="chip">Today: ${ticked.size}${tg.o ? ` / ${tg.o}` : ''} ticked</span><span class="chip">🏅 = practised ${goal}× or more</span>` })}
  <section class="card coverage">
    <svg class="mini-ring" viewBox="0 0 80 80" aria-hidden="true"><circle class="bg" cx="40" cy="40" r="${r}"/><circle class="fg" cx="40" cy="40" r="${r}" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(2)}"/></svg>
    <div class="cov-pct">${Math.round(pct * 100)}%</div>
    <div><b>${atGoal} of ${total} stations</b> practised ${goal}+ times<p class="muted small">${tried} tried at least once · ${total - tried} not started yet</p></div>
  </section>
  <section class="card tip">
    <b>🔁 Due</b> means it’s time to refresh a station. Each one comes back after 2 days, then 4, then 7, then every 10 — spacing it out is what makes it stick.
  </section>
  ${categories().map(cat => `<section class="cat"><h3>${esc(cat)}</h3><div class="tiles">${state.stations.filter(s => s.cat === cat).map(tile).join('')}</div></section>`).join('')}
  ${ui.osceEdit ? `<section class="card">
    <div class="card-head"><h2>Add a station</h2></div>
    <form id="addStation" class="add-form">
      <input id="newStationName" type="text" maxlength="60" placeholder="e.g. Diabetes counselling" required>
      <select id="newStationCat">${categories().map(c => `<option>${esc(c)}</option>`).join('')}<option value="__new">New group…</option></select>
      <input id="newStationCatName" type="text" maxlength="40" placeholder="New group name" hidden>
      <button class="btn primary wide" type="submit">Add station</button>
    </form>
    <button class="link-btn" data-action="restoreStations">Restore the default stations</button>
  </section>` : ''}`;
}

function viewSettings(p) {
  const s = state.settings;
  const stepper = (key, label, step, sub) => `<div class="row"><div><div class="row-label">${label}</div>${sub ? `<div class="row-sub">${sub}</div>` : ''}</div>
    <div class="stepper"><button data-action="step" data-key="${key}" data-step="${-step}" aria-label="Decrease">−</button><output>${s[key]}</output><button data-action="step" data-key="${key}" data-step="${step}" aria-label="Increase">+</button></div></div>`;
  const dateRow = (key, label, sub) => `<div class="row"><div><div class="row-label">${label}</div>${sub ? `<div class="row-sub">${sub}</div>` : ''}</div><input type="date" data-setting="${key}" value="${s[key]}"></div>`;
  const rests = Object.entries(state.logs).filter(([k, l]) => l.rest && k >= s.start && k <= p.last).length;
  return `
  ${hero({ eyebrow: 'Settings', title: 'Your plan' })}
  <section class="card">
    <div class="row"><div><div class="row-label">Your name</div><div class="row-sub">For the hello on the Today screen</div></div><input type="text" data-setting="name" value="${esc(s.name)}" placeholder="Optional" maxlength="40" class="short-input"></div>
    ${dateRow('start', 'Plan starts', 'Days before this aren’t counted')}
    ${dateRow('placementEnd', 'Last day of placement', 'Lighter targets until then')}
    ${dateRow('exam', 'Finals start', 'Your plan runs up to the day before')}
  </section>
  <section class="card">
    <div class="card-head"><h2>Daily targets</h2></div>
    ${stepper('qPlacement', '🏥 Questions / day on placement', 5)}
    ${stepper('qRevision', '📚 Questions / day on revision break', 5, 'Aim: 100–150')}
    ${stepper('oPlacement', '🏥 OSCE stations / day on placement', 1)}
    ${stepper('oRevision', '📚 OSCE stations / day on revision break', 1)}
    ${stepper('coverageGoal', '🏅 Practise each station', 1, 'times, to earn its medal')}
    <p class="plan-total">Your plan: <b>${num(p.goalQ)} questions</b> and <b>${num(p.goalO)} OSCE stations</b> by ${p.n ? fmtShort(p.last) : '—'}${rests ? `, with ${plural(rests, 'rest day', 'rest days')}` : ''}.</p>
    <p class="muted small">Rest days (tap a day in the calendar) pause that day’s target. Christmas, anyone? 🎄</p>
  </section>
  <section class="card">
    <div class="card-head"><h2>On your iPhone</h2></div>
    <ol class="steps"><li>Open this page in <b>Safari</b>.</li><li>Tap <b>Share</b> (the square with an arrow).</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>
    <p class="muted small">Your progress is saved on this phone only. Make a backup now and then — it’s one tap.</p>
  </section>
  ${DEMO ? '' : `<section class="card">
    <div class="card-head"><h2>Try it out</h2></div>
    <p class="muted small">Opens a demo with four weeks of made-up progress so you can see the charts and calendar in action. Your real data isn’t touched.</p>
    <button class="btn soft wide" data-action="tryDemo">🧪 Try with sample data</button>
  </section>`}
  <section class="card">
    <div class="card-head"><h2>Backup</h2></div>
    <div class="two-btns"><button class="btn soft" data-action="exportData">Save a backup</button><button class="btn soft" data-action="importData">Restore backup</button></div>
    <input type="file" id="importFile" accept="application/json,.json" hidden>
    <button class="link-btn danger" data-action="resetAll">Start over (deletes everything)</button>
  </section>
  <p class="footer">Revision Pulse 💓 · made with care for finals</p>`;
}

// ---------- Sheets (bottom pop-ups) ----------
function sheetHTML() {
  const sh = sheet, d = sh.date;
  if (sh.type === 'welcome') {
    const s = state.settings;
    return `<div class="welcome">
      <div class="welcome-art">💓</div>
      <h2>Revision Pulse</h2>
      <p class="lead">Tick off what you did each day. Your progress line shows whether you’re on target for finals.</p>
      <ul class="how"><li><span>✅</span>Log questions in one tap</li><li><span>🩺</span>Tick the OSCE stations you practise</li><li><span>📚</span>Track the UKMLA topics you’ve worked through</li><li><span>🐢</span>Stay ahead of the tortoise = on track</li></ul>
      <label>Your first name <small>(optional)</small><input id="w-name" type="text" maxlength="40" autocomplete="given-name" value="${esc(s.name)}"></label>
      <div class="two"><label>Placement ends<input id="w-plc" type="date" value="${s.placementEnd}"></label><label>Finals start<input id="w-exam" type="date" value="${s.exam}"></label></div>
      <div class="two"><label>🏥 Placement Qs/day<input id="w-qp" type="number" inputmode="numeric" min="0" max="400" value="${s.qPlacement}"></label><label>📚 Revision Qs/day<input id="w-qr" type="number" inputmode="numeric" min="0" max="400" value="${s.qRevision}"></label></div>
      <p class="muted small">You can change all of this later in Settings.</p>
      <button class="btn primary wide big" data-action="startPlan">Start my plan</button>
    </div>`;
  }
  if (sh.type === 'number') {
    return `<h3>Questions done</h3><p class="muted small">${fmtLong(d)}</p>
      <input id="numInput" class="num-input" type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="5000" value="${getLog(d).q || ''}" placeholder="0">
      <div class="two-btns"><button class="btn ghost" data-action="${sh.back ? 'backToDay' : 'closeSheet'}" data-date="${d}">Cancel</button><button class="btn primary" data-action="saveNumber" data-date="${d}">Save</button></div>`;
  }
  if (sh.type === 'area') {
    const st = topicStats().groups.find(x => x.g.id === sh.id);
    if (!st) return '';
    return `<div class="sheet-head"><div><h3>${st.g.emoji} ${esc(st.g.name)}</h3><p class="muted small"><b>${st.rated}</b> of ${st.total} worked through</p></div>
        <button class="btn small primary" data-action="closeSheet">Done</button></div>
      ${stackBar(st.counts, st.total)}
      <p class="rate-help">Tap how you feel: 😬 shaky · 🙂 OK · 💪 confident. Tap again to clear.</p>
      <div class="sheet-body">${st.g.items.map(it => topicRow(it)).join('')}</div>`;
  }
  if (sh.type === 'stations') {
    const counts = stationCounts(), ticked = new Set(getLog(d).osce);
    return `<div class="sheet-head"><div><h3>OSCE stations</h3><p class="muted small">${fmtLong(d)} · <b>${ticked.size}</b> ticked</p></div>
        <button class="btn small primary" data-action="${sh.back ? 'backToDay' : 'closeSheet'}" data-date="${d}">Done</button></div>
      <input id="stationSearch" type="search" placeholder="Search stations" autocomplete="off">
      <div class="sheet-body">${categories().map(cat => `<div class="st-group"><h4>${esc(cat)}</h4>${state.stations.filter(s => s.cat === cat).map(st => {
        const on = ticked.has(st.id), c = counts[st.id] || 0;
        return `<button class="st-row ${on ? 'on' : ''}" data-action="toggleStation" data-id="${esc(st.id)}" data-date="${d}" data-name="${esc(st.name.toLowerCase())}"><span class="check">${on ? '✓' : ''}</span><span class="st-name">${esc(st.name)}</span><span class="st-count">${c ? `${c}×` : 'new'}</span></button>`;
      }).join('')}</div>`).join('')}<p class="muted small none" hidden>No station matches that.</p></div>`;
  }
  if (sh.type === 'day') {
    const log = getLog(d), tg = dayTargets(d), future = d > todayKey();
    const phase = phaseTargets(d).phase === 'placement' ? '🏥 Placement day' : '📚 Revision day';
    const restBtn = `<button class="toggle ${log.rest ? 'on' : ''}" data-action="toggleRest" data-date="${d}"><span>🛌 Rest day<small>${log.rest ? 'No target this day' : 'Pauses this day’s target'}</small></span><span class="switch" aria-hidden="true"></span></button>`;
    if (future) return `<div class="sheet-head"><div><h3>${fmtLong(d)}</h3><p class="muted small">${phase} · target ${tg.q} questions, ${tg.o} stations</p></div><button class="btn small primary" data-action="closeSheet">Done</button></div>
      <p>Planning ahead? Mark this as a rest day and the plan won’t expect anything from you.</p>${restBtn}`;
    return `<div class="sheet-head"><div><h3>${fmtLong(d)}</h3><p class="muted small">${phase} · target ${tg.q} questions, ${tg.o} stations</p></div><button class="btn small primary" data-action="closeSheet">Done</button></div>
      <div class="sheet-body">
        <div class="day-block"><div class="mini-label">Questions</div>
          <div class="day-q"><button class="btn ghost" data-action="addQ" data-n="-10" data-date="${d}">−10</button>
          <button class="day-val" data-action="openNumber" data-date="${d}" data-back="1">${num(log.q)}<small>tap to type</small></button>
          <button class="btn primary" data-action="addQ" data-n="10" data-date="${d}">+10</button></div></div>
        <div class="day-block"><div class="mini-label">OSCE stations</div>
          ${log.osce.length ? `<div class="chips">${log.osce.map(id => `<span class="schip on static">✓ ${esc(stationName(id))}</span>`).join('')}</div>` : '<p class="muted small">None ticked.</p>'}
          <button class="btn soft wide" data-action="openStations" data-date="${d}" data-back="1">Edit stations</button></div>
        ${restBtn}
      </div>`;
  }
  return '';
}

function renderSheet() {
  const root = $('#sheet-root');
  if (!sheet) { root.innerHTML = ''; document.body.classList.remove('locked'); return; }
  const prevBody = $('.sheet-body', root), scroll = prevBody ? prevBody.scrollTop : 0;
  const prevSearch = $('#stationSearch', root), query = prevSearch ? prevSearch.value : '';
  const kind = sheet.type === 'number' ? 'dialog' : sheet.type;
  root.innerHTML = `<div class="backdrop ${sheet.fresh ? 'enter' : ''}" ${sheet.type === 'welcome' ? '' : 'data-action="closeSheet"'}></div>
    <div class="sheet ${kind} ${sheet.fresh ? 'enter' : ''}" role="dialog" aria-modal="true">${sheetHTML()}</div>`;
  document.body.classList.add('locked');
  const body = $('.sheet-body', root); if (body) body.scrollTop = scroll;
  const search = $('#stationSearch', root); if (search && query) { search.value = query; filterStations(query); }
  sheet.fresh = false;
}
function openSheet(s) {
  sheet = { ...s, fresh: true };
  renderSheet();
  if (s.type === 'number') { const inp = $('#numInput'); if (inp) { inp.focus(); inp.select(); } }
}
function closeSheet() { sheet = null; renderSheet(); }

function filterStations(q) {
  q = q.trim().toLowerCase();
  let any = false;
  for (const g of $$('.st-group')) {
    let vis = 0;
    for (const row of $$('.st-row', g)) { const show = !q || row.dataset.name.includes(q); row.hidden = !show; if (show) vis++; }
    g.hidden = vis === 0; if (vis) any = true;
  }
  const none = $('.sheet .none'); if (none) none.hidden = any;
}

// ---------- Rendering ----------
const VIEWS = { today: viewToday, journey: viewJourney, topics: viewTopics, osce: viewOsce, settings: viewSettings };
function render() {
  const tab = currentTab();
  let html = VIEWS[tab](buildPlan());
  if (DEMO) html = html.replace('</header>', `</header><div class="demo-bar"><span>🧪 <b>Demo</b> · made-up data, pretending it’s ${fmt(todayKey(), { weekday: 'short', day: 'numeric', month: 'short' })}</span><span class="demo-btns"><button data-action="resetDemo">Reset</button><button data-action="exitDemo">Exit</button></span></div>`);
  $('#app').innerHTML = html;
  ui.pop = false;
  for (const el of $$('.tab')) { const on = el.dataset.tab === tab; el.classList.toggle('active', on); el.setAttribute('aria-current', on ? 'page' : 'false'); }
  if (sheet) renderSheet();
}

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- Celebrations ----------
const confetti = (() => {
  const cv = $('#confetti'), ctx = cv.getContext('2d');
  const colors = ['#6D4AFF', '#FF5FA2', '#1FC99A', '#FFB020', '#4CC3FF'];
  let parts = [], raf = 0;
  const resize = () => { const r = devicePixelRatio || 1; cv.width = innerWidth * r; cv.height = innerHeight * r; ctx.setTransform(r, 0, 0, r, 0, 0); };
  function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(p => p.life < 200 && p.y < innerHeight + 40);
    for (const p of parts) {
      p.life++; p.vy += 0.3; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - p.life / 200); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 6)));
      ctx.restore();
    }
    raf = parts.length ? requestAnimationFrame(tick) : 0;
  }
  return {
    fire() {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      resize();
      for (let i = 0; i < 150; i++) {
        const left = i % 2 === 0;
        parts.push({ x: left ? -10 : innerWidth + 10, y: innerHeight * 0.7, vx: (left ? 1 : -1) * (3 + Math.random() * 8), vy: -(8 + Math.random() * 10),
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, c: colors[i % colors.length], life: 0, round: Math.random() < 0.3 });
      }
      if (!raf) raf = requestAnimationFrame(tick);
    },
  };
})();

function celebrateIfDone(date, before) {
  if (date !== todayKey()) return;
  const log = getLog(date), tg = dayTargets(date);
  const qNow = tg.q > 0 && log.q >= tg.q, oNow = tg.o > 0 && log.osce.length >= tg.o;
  const qNew = qNow && !(before.q >= tg.q), oNew = oNow && !(before.o >= tg.o);
  if (!qNew && !oNew) return;
  confetti.fire();
  const both = (tg.q === 0 || qNow) && (tg.o === 0 || oNow);
  toast(both ? pick(BOTH) : qNew ? pick(Q_DONE) : pick(O_DONE));
}

function changeDay(date, mutate) {
  const prev = getLog(date);
  const before = { q: prev.q, o: prev.osce.length };
  if (date === todayKey()) { const tg = dayTargets(date); ui.ringFrom = tg.q > 0 ? Math.min(prev.q / tg.q, 1) : (prev.q > 0 ? 1 : 0); }
  mutate(prev);
  render();
  celebrateIfDone(date, before);
}

// ---------- Actions ----------
const actions = {
  tab: d => { if (location.hash.slice(1) !== d.tab) { location.hash = d.tab; } else { render(); } window.scrollTo(0, 0); },
  addQ: d => {
    const date = d.date || todayKey();
    changeDay(date, prev => { setLog(date, { q: clamp(prev.q + Number(d.n), 0, 5000) }); ui.pop = true; });
  },
  openNumber: d => openSheet({ type: 'number', date: d.date, back: !!d.back }),
  saveNumber: d => {
    const val = clampInt($('#numInput').value || 0, 0, 5000, 0);
    const back = sheet && sheet.back;
    changeDay(d.date, () => { setLog(d.date, { q: val }); ui.pop = true; });
    if (back) openSheet({ type: 'day', date: d.date }); else closeSheet();
  },
  openStations: d => openSheet({ type: 'stations', date: d.date, back: !!d.back }),
  toggleStation: d => {
    changeDay(d.date, prev => {
      const set = new Set(prev.osce);
      if (set.has(d.id)) set.delete(d.id); else set.add(d.id);
      setLog(d.date, { osce: [...set] });
    });
  },
  toggleRest: d => {
    const wasRest = getLog(d.date).rest;
    setLog(d.date, { rest: !wasRest });
    render();
    toast(wasRest ? 'Rest day cancelled' : d.date === todayKey() ? 'Rest day — rest is revision too 💜' : `Rest day planned for ${fmtShort(d.date)} 💜`);
  },
  openDay: d => openSheet({ type: 'day', date: d.date }),
  backToDay: d => openSheet({ type: 'day', date: d.date }),
  closeSheet: () => closeSheet(),
  chart: d => { ui.chart = d.kind; render(); },
  osceEdit: () => { ui.osceEdit = !ui.osceEdit; render(); },
  deleteStation: d => {
    const st = state.stations.find(s => s.id === d.id);
    if (!st || !confirm(`Remove “${st.name}” from your list? Past ticks still count towards your totals.`)) return;
    state.stations = state.stations.filter(s => s.id !== d.id); save(); render();
  },
  restoreStations: () => {
    const have = new Set(state.stations.map(s => s.id));
    const missing = defaultStations().filter(s => !have.has(s.id));
    if (!missing.length) return toast('All the default stations are already here');
    state.stations.push(...missing); save(); render(); toast(`Added back ${plural(missing.length, 'station', 'stations')}`);
  },
  step: d => {
    const [lo, hi] = LIMITS[d.key];
    state.settings[d.key] = clamp(state.settings[d.key] + Number(d.step), lo, hi);
    save(); render();
  },
  dismissInstall: () => { state.installDismissed = true; save(); render(); },
  exportData: () => exportData(),
  importData: () => $('#importFile').click(),
  openArea: d => openSheet({ type: 'area', id: d.id }),
  topicSort: d => { ui.topicSort = d.sort; render(); },
  toggleShaky: () => { ui.showAllShaky = !ui.showAllShaky; render(); },
  rate: d => {
    const v = Number(d.r), cur = (state.topics[d.id] || {}).r || 0;
    const g = TOPIC_GROUPS.find(x => x.items.some(it => it.id === d.id));
    const covered = () => g ? g.items.filter(it => state.topics[it.id]).length : 0;
    const before = covered();
    if (cur === v) delete state.topics[d.id]; else state.topics[d.id] = { r: v, d: todayKey() };
    save(); render();
    if (g && before < g.items.length && covered() === g.items.length) { confetti.fire(); toast(`${g.emoji} ${g.name}: every topic covered! 🎉`); }
  },
  tryDemo: () => { location.href = `${location.pathname}?demo#today`; },
  exitDemo: () => { location.href = `${location.pathname}#today`; },
  resetDemo: () => { state = demoState(); save(); closeSheet(); render(); window.scrollTo(0, 0); toast('Demo reset 🧪'); },
  resetAll: () => {
    if (!confirm('Delete all your progress and start again? This can’t be undone. (Tip: save a backup first.)')) return;
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    state = defaultState(); location.hash = 'today'; render(); openSheet({ type: 'welcome' });
  },
  startPlan: () => {
    const v = id => $(`#${id}`).value;
    const s = { ...state.settings };
    s.name = v('w-name').trim().slice(0, 40);
    if (isKey(v('w-plc'))) s.placementEnd = v('w-plc');
    if (isKey(v('w-exam'))) s.exam = v('w-exam');
    if (s.exam <= s.start) return toast('Finals need to be after today');
    s.qPlacement = clampInt(v('w-qp'), ...LIMITS.qPlacement, s.qPlacement);
    s.qRevision = clampInt(v('w-qr'), ...LIMITS.qRevision, s.qRevision);
    state.settings = s; state.onboarded = true; save();
    closeSheet(); render();
    setTimeout(() => { confetti.fire(); toast('Plan ready — let’s go! 🚀'); }, 250);
  },
};

async function exportData() {
  const text = JSON.stringify({ app: 'revision-pulse', exported: new Date().toISOString(), ...state }, null, 2);
  const name = `revision-pulse-backup-${todayKey()}.json`;
  try {
    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Revision Pulse backup' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Backup saved 💾');
}

function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) { return toast('That file isn’t a Revision Pulse backup'); }
    if (!data || typeof data !== 'object' || !data.settings || !data.logs) return toast('That file isn’t a Revision Pulse backup');
    if (!confirm('Replace what’s on this phone with the backup?')) return;
    state = normalise(data); state.onboarded = true; save(); closeSheet(); render(); toast('Backup restored ✅');
  };
  reader.readAsText(file);
}

function updateSetting(key, value) {
  const s = { ...state.settings };
  if (key === 'name') s.name = String(value).trim().slice(0, 40);
  else if (['start', 'placementEnd', 'exam'].includes(key)) {
    if (!isKey(value)) return render();
    s[key] = value;
    if (s.exam <= s.start) { toast('Finals need to be after the plan start'); return render(); }
  } else return;
  state.settings = s; save(); render();
}

// ---------- Events ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el.dataset, el, e); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset && el.dataset.setting) updateSetting(el.dataset.setting, el.value);
  else if (el.id === 'importFile' && el.files && el.files[0]) { importFile(el.files[0]); el.value = ''; }
  else if (el.id === 'newStationCat') { const n = $('#newStationCatName'); n.hidden = el.value !== '__new'; if (!n.hidden) n.focus(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'stationSearch') filterStations(e.target.value);
  if (e.target.id === 'topicSearch') { ui.topicQuery = e.target.value; $('#topicResults').innerHTML = topicResultsHTML(ui.topicQuery); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'numInput') { e.preventDefault(); $('[data-action="saveNumber"]').click(); }
  if (e.key === 'Escape' && sheet && sheet.type !== 'welcome') closeSheet();
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'addStation') return;
  e.preventDefault();
  const name = $('#newStationName').value.trim().slice(0, 60);
  let cat = $('#newStationCat').value;
  if (cat === '__new') cat = $('#newStationCatName').value.trim().slice(0, 40) || 'Other';
  if (!name) return;
  let id = slug(`${cat}-${name}`) || `station-${Date.now()}`;
  while (state.stations.some(s => s.id === id)) id += '-x';
  state.stations.push({ id, name, cat }); save(); render(); toast(`Added “${name}” ✨`);
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
// Re-render when coming back to the app (e.g. the date may have changed overnight).
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

// ---------- Start ----------
render();
if (!state.onboarded) openSheet({ type: 'welcome' });
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.search.includes('sw'))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
})();
