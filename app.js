const MONO = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';
const SANS = '"Segoe UI", system-ui, sans-serif';

const ORDER_KEY = 'chartOrder_v2';

const ROLES = [
  { id:'rpm', match: n => /обороты\s+двигателя/.test(n) && !/x\s*\d+/.test(n), unit:'rpm', color:'#FFC107', minVal:0 },
  { id:'uoz', match: n => /опережени|уоз|зажиган|ignition\s*timing|ignition\s*angle/.test(n), unit:'°', color:'#AB47BC', zeroLine:true, negColor:'#FF5252', retardChart:true, multi:true },
  { id:'correction', match: n => /кратковременная\s+коррекция/.test(n), unit:'%', color:'#26A69A', anomaly:[-15,15], anomalyColor:'#FF5252' },
  { id:'manifold', match: n => /впускном\s+коллекторе/.test(n), unit:'kPa', color:'#FF7043', minVal:0 },
  { id:'intakeTemp', match: n => /всасываемого\s+воздуха/.test(n), unit:'℃', color:'#EC407A', alertLine:45 },
  { id:'throttle', match: n => /дроссел|дпдз|throttle/.test(n), unit:'%', color:'#66BB6A', minVal:0, maxVal:100, flapChart:true },
  { id:'speed', match: n => /скорость\s+автомобиля/.test(n), unit:'km/h', color:'#42A5F5', minVal:0 },
  { id:'boost', match: n => /наддув/.test(n) || /boost/.test(n), unit:'bar', color:'#FF8A65', turboChart:true },
  { id:'maf', match: n => /расход\s+воздуха/.test(n) && !/топлив/.test(n), unit:'g/s', color:'#26C6DA', minVal:0 },
  { id:'afr', match: n => /топливо\s*\/?\s*воздух/.test(n) || /\bafr\b/.test(n), unit:'', color:'#FFA726' },
  { id:'coolant', match: n => /охлаждающей\s+жидкости/.test(n), unit:'℃', color:'#EF5350' },
  { id:'catalystTemp', match: n => /катализатор|catalyst/i.test(n), unit:'℃', color:'#FF5722' },
  { id:'knockDetected', match: n => /knock\s+detected/.test(n), unit:'', color:'#FF1744', minVal:0, maxVal:1, knockChart:true },
  { id:'knockActive', match: n => /knock\s+control\s+active/.test(n) && !/adaptation/.test(n), unit:'', color:'#FF6E40', minVal:0, maxVal:1 },
  { id:'knockAdapt', match: n => /knock/.test(n) && /(adaptation|адаптац)/.test(n), unit:'', color:'#FFB74D', minVal:0, maxVal:1 },
  { id:'load', match: n => /нагрузк/.test(n) && /двигател/.test(n), unit:'%', color:'#BA68C8', minVal:0 },
  { id:'accel', match: n => /ускорение/.test(n) || /acceleration/.test(n), unit:'g', color:'#7E57C2' },
];
const MULTI_PALETTE = ['#AB47BC','#7E57C2','#5C6BC0','#42A5F5','#26C6DA','#26A69A','#9CCC65','#FFCA28','#FFA726','#FF7043','#EF5350','#EC407A'];
const EXTRA_COLORS = ['#8AB4F8','#F28B82','#81C995','#FDD663','#C58AF9','#78D9EC','#F6AEA9','#A8DAB5','#FFB77D','#D7A9E3','#AECBFA','#FDE293'];

const SKIP_PATTERNS = [/^(\[[^\]]*\]\s*)?обороты\s+двигателя\s*x\s*\d+\s*$/i];

const MIN_RPM = 1000, TPS_RELEASED = 15, TPS_WOT = 84, LOAD_MIN = 25, RPM_DROP_EPS = 15;
const FLAP_ZONE = [45, 85], FLAP_AMP = 8, FLAP_RPM_DROP = 30;
const TURBO_UNDERBOOST = 0.3, TURBO_WOT_RPM = 2000, TURBO_DELTA = 0.5, TURBO_DROP_TPS = 50;
const MERGE_RETARD = 2, MERGE_FLAP = 2, MERGE_TURBO = 3, MERGE_KNOCK = 2;
const CHART_H = 176, MAX_CHIPS = 500;

let allData = {}, paramConfigs = {}, roleParams = {}, chartOrder = [], naturalOrder = [];
let totalTime = 0, windowSize = 30, timePosition = 0;
let chartEls = [], mouseX = -1, rafPending = false, dragState = null;
let dangerRetards = [], throttleFlaps = [], turboEvents = [], knockEvents = [];
let pendingFlash = null, chartTouch = null;
const dpr = window.devicePixelRatio || 1;

function setCookie(n, v, d) { const e = new Date(); e.setTime(e.getTime() + (d||365)*864e5); document.cookie = n+'='+encodeURIComponent(v)+';expires='+e.toUTCString()+';path=/;SameSite=Lax'; }
function getCookie(n) { const m = document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; }
function saveSetting(k, v) { try { localStorage.setItem('logview_'+k, v); } catch(e){} try { setCookie('logview_'+k, v); } catch(e){} }
function loadSetting(k) { const c = getCookie('logview_'+k); if (c !== null && c !== '') return c; try { return localStorage.getItem('logview_'+k); } catch(e) { return null; } }
function clearSavedOrder() {
  try { localStorage.removeItem('logview_' + ORDER_KEY); } catch(e){}
  try { document.cookie = 'logview_' + ORDER_KEY + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'; } catch(e){}
}
function saveOrder() {
  const domOrder = Array.from(document.querySelectorAll('#charts .chart-box')).map(b => b.dataset.name);
  chartOrder.forEach(n => { if (domOrder.indexOf(n) === -1) domOrder.push(n); });
  chartOrder = domOrder;
  saveSetting(ORDER_KEY, JSON.stringify(domOrder));
}
function applySavedOrder(available) {
  let saved = null;
  try { saved = JSON.parse(loadSetting(ORDER_KEY) || 'null'); } catch(e) {}
  const order = [];
  if (Array.isArray(saved)) saved.forEach(n => { if (available.indexOf(n) !== -1 && order.indexOf(n) === -1) order.push(n); });
  available.forEach(n => { if (order.indexOf(n) === -1) order.push(n); });
  return order;
}

function loadFile(file) {
  const r = new FileReader();
  r.onload = ev => { try { parseAndDraw(ev.target.result, file.name); } catch (err) { document.getElementById('fileInfo').textContent = '⚠ Ошибка разбора: ' + err.message; } };
  r.onerror = () => { document.getElementById('fileInfo').textContent = '⚠ Не удалось прочитать файл'; };
  r.readAsText(file);
}
document.getElementById('fileInput').addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });
let dragDepth = 0;
document.addEventListener('dragenter', e => { e.preventDefault(); if (++dragDepth === 1) document.body.classList.add('drop-active'); });
document.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drop-active'); } });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('drop-active'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

const wsSlider = document.getElementById('windowSize');
document.getElementById('zoomIn').addEventListener('click', () => { windowSize = Math.round(Math.max(5, windowSize * 0.7)); updateControls(); saveSetting('windowSize', windowSize); scheduleRender(); });
document.getElementById('zoomOut').addEventListener('click', () => { windowSize = Math.round(Math.min(parseFloat(wsSlider.max), windowSize * 1.4)); updateControls(); saveSetting('windowSize', windowSize); scheduleRender(); });
document.getElementById('resetZoom').addEventListener('click', () => {
  windowSize = 30; timePosition = 0;
  clearSavedOrder();
  chartOrder = naturalOrder.slice();
  saveSetting('windowSize', windowSize);
  updateControls();
  buildCharts(); renderAll();
});
wsSlider.addEventListener('input', e => { windowSize = parseFloat(e.target.value); updateControls(); saveSetting('windowSize', windowSize); scheduleRender(); });
document.getElementById('timePosition').addEventListener('input', e => { timePosition = parseFloat(e.target.value) / 100 * Math.max(0, totalTime - windowSize); updateControls(); scheduleRender(); });
document.getElementById('fixedScale').addEventListener('change', e => { saveSetting('fixedScale', e.target.checked ? '1' : '0'); scheduleRender(); });
document.getElementById('eventsHead').addEventListener('click', () => {
  const p = document.getElementById('eventsPanel');
  p.classList.toggle('open');
  document.getElementById('eventsToggleHint').textContent = p.classList.contains('open') ? 'клик — свернуть' : 'клик — развернуть';
});
window.addEventListener('wheel', e => {
  if (!e.shiftKey || totalTime <= 0) return;
  e.preventDefault();
  const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  const norm = raw * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 120 : 1);
  const maxPos = Math.max(0, totalTime - windowSize);
  timePosition = Math.max(0, Math.min(maxPos, timePosition + norm * windowSize / 600));
  updateControls(); scheduleRender();
}, { passive: false });
let resizeTimer;
window.addEventListener('resize', () => { if (!totalTime) return; clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { buildCharts(); renderAll(); updateTimeline(); }, 120); });

function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; renderAll(); applyPendingFlash(); });
}
function applyPendingFlash() {
  if (!pendingFlash) return;
  const box = document.querySelector('.chart-box[data-name="' + pendingFlash + '"]');
  if (box) { box.classList.add('flash'); setTimeout(() => box.classList.remove('flash'), 950); box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  pendingFlash = null;
}
function updateControls() {
  const maxPos = Math.max(0, totalTime - windowSize);
  timePosition = Math.max(0, Math.min(timePosition, maxPos));
  wsSlider.value = windowSize;
  document.getElementById('windowSizeDisplay').textContent = formatWin(windowSize);
  document.getElementById('timePosition').value = maxPos ? (timePosition / maxPos) * 100 : 0;
  document.getElementById('timePositionDisplay').textContent = timePosition.toFixed(0) + '–' + (timePosition + windowSize).toFixed(0) + 's';
  updateTimeline();
}

// ===== ТАЙМЛАЙН (нижняя полоса прокрутки) =====
function updateTimeline() {
  const tl = document.getElementById('timeline');
  const track = document.getElementById('timelineTrack');
  const thumb = document.getElementById('timelineThumb');
  const label = document.getElementById('timelineLabel');
  if (!tl || !track || !thumb) return;
  if (!totalTime) { tl.style.display = 'none'; return; }
  tl.style.display = 'block';
  const tw = track.clientWidth;
  if (!tw) return;
  const thumbW = Math.max(28, (windowSize / totalTime) * tw);
  const maxLeft = Math.max(0, tw - thumbW);
  const maxPos = Math.max(0, totalTime - windowSize);
  const left = maxPos > 0 ? (timePosition / maxPos) * maxLeft : 0;
  thumb.style.width = thumbW + 'px';
  thumb.style.left = left + 'px';
  if (label) label.textContent = formatWin(timePosition) + ' – ' + formatWin(Math.min(totalTime, timePosition + windowSize)) + '  /  ' + formatDur(totalTime);
}
(function initTimeline() {
  const track = document.getElementById('timelineTrack');
  if (!track) return;
  let dragging = false;
  function setFromX(clientX) {
    const rect = track.getBoundingClientRect();
    const tw = rect.width;
    const thumbW = Math.max(28, (windowSize / totalTime) * tw);
    const maxLeft = Math.max(0, tw - thumbW);
    let x = clientX - rect.left - thumbW / 2;
    x = Math.max(0, Math.min(maxLeft, x));
    const maxPos = Math.max(0, totalTime - windowSize);
    timePosition = maxLeft > 0 ? (x / maxLeft) * maxPos : 0;
    updateControls(); scheduleRender();
  }
  track.addEventListener('pointerdown', e => { dragging = true; try { track.setPointerCapture(e.pointerId); } catch(_){} setFromX(e.clientX); });
  track.addEventListener('pointermove', e => { if (dragging) setFromX(e.clientX); });
  track.addEventListener('pointerup', () => { dragging = false; });
  track.addEventListener('pointercancel', () => { dragging = false; });
})();

// ===== ЖЕСТЫ НА ГРАФИКАХ (тач: тап / свайп / щипок) =====
function pinchDist(ts) { const dx = ts[0].clientX - ts[1].clientX, dy = ts[0].clientY - ts[1].clientY; return Math.hypot(dx, dy); }
function onChartTouchStart(e) {
  if (e.touches.length === 2) {
    chartTouch = { mode: 'pinch', d0: pinchDist(e.touches), w0: windowSize };
  } else if (e.touches.length === 1) {
    const t = e.touches[0];
    chartTouch = { mode: 'maybe', x0: t.clientX, y0: t.clientY, t0: Date.now(), pos0: timePosition, moved: false, rect: e.currentTarget.getBoundingClientRect() };
  }
}
function onChartTouchMove(e) {
  if (!chartTouch) return;
  if (chartTouch.mode === 'pinch') {
    if (e.touches.length >= 2) {
      e.preventDefault();
      const d = pinchDist(e.touches);
      if (d > 0 && chartTouch.d0 > 0) {
        const scale = d / chartTouch.d0;
        let nw = chartTouch.w0 / scale;
        nw = Math.max(5, Math.min(parseFloat(wsSlider.max) || 300, nw));
        if (Math.abs(nw - windowSize) > 0.5) { windowSize = nw; updateControls(); saveSetting('windowSize', windowSize); scheduleRender(); }
      }
    }
    return;
  }
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  const dx = t.clientX - chartTouch.x0, dy = t.clientY - chartTouch.y0;
  if (chartTouch.mode === 'maybe') {
    if (Math.abs(dx) > Math.abs(dy) * 1.3 && Math.abs(dx) > 8) chartTouch.mode = 'pan';
    else if (Math.abs(dy) > 8) chartTouch.mode = 'vscroll';
  }
  if (chartTouch.mode === 'pan') {
    e.preventDefault();
    chartTouch.moved = true;
    if (mouseX !== -1) { mouseX = -1; updateOverlay(); }
    const w = chartTouch.rect.width || 300;
    const pxPerSec = w / windowSize;
    const maxPos = Math.max(0, totalTime - windowSize);
    timePosition = Math.max(0, Math.min(maxPos, chartTouch.pos0 - dx / pxPerSec));
    updateControls(); scheduleRender();
  }
}
function onChartTouchEnd(e) {
  if (!chartTouch) return;
  if (chartTouch.mode === 'maybe' && !chartTouch.moved && e.changedTouches.length) {
    const t = e.changedTouches[0];
    if (Date.now() - chartTouch.t0 < 400) { mouseX = t.clientX - chartTouch.rect.left; updateOverlay(); }
  }
  if (e.touches.length === 0) chartTouch = null;
  else if (chartTouch.mode === 'pinch') chartTouch = null;
}

function makeShortName(name, roleId) {
  if (roleId === 'uoz') {
    const m = name.match(/цилиндр\s*[:.#]?\s*(\d+)/i) || name.match(/cyl(?:inder)?\s*[:.#]?\s*(\d+)/i) || name.match(/#?\s*(\d+)\s*$/);
    return m ? 'УОЗ цил.' + m[1] : 'УОЗ';
  }
  if (roleId === 'knockDetected') return 'Детонация';
  if (roleId === 'knockActive') return 'Knock control';
  if (roleId === 'knockAdapt') return 'Knock adapt';
  return name;
}
function normName(n) {
  return n.replace(/^\s*\[[^\]]*\]\s*/, '').trim().toLowerCase();
}
function classifyParams(rawData, rawUnits) {
  allData = rawData; paramConfigs = {}; roleParams = {};
  ROLES.forEach(r => roleParams[r.id] = []);
  const names = Object.keys(rawData);
  const classified = new Set();
  ROLES.forEach(role => {
    const matches = names.filter(n => role.match(normName(n)) && !classified.has(n));
    matches.sort();
    matches.forEach((n, idx) => {
      classified.add(n);
      roleParams[role.id].push(n);
      paramConfigs[n] = {
        name: n, shortName: makeShortName(n, role.id),
        unit: role.unit !== undefined ? role.unit : (rawUnits[n] || ''),
        color: role.multi ? MULTI_PALETTE[idx % MULTI_PALETTE.length] : role.color,
        role: role.id, minVal: role.minVal, maxVal: role.maxVal,
        anomaly: role.anomaly, anomalyColor: role.anomalyColor, alertLine: role.alertLine,
        zeroLine: role.zeroLine, negColor: role.negColor,
        retardChart: role.retardChart, flapChart: role.flapChart,
        turboChart: role.turboChart, knockChart: role.knockChart,
      };
    });
  });
  const extras = names.filter(n => !classified.has(n));
  extras.forEach((n, idx) => { paramConfigs[n] = { name: n, shortName: n, unit: rawUnits[n] || '', color: EXTRA_COLORS[idx % EXTRA_COLORS.length], role: 'extra' }; });
  const defaultOrder = [];
  ROLES.forEach(role => roleParams[role.id].forEach(n => defaultOrder.push(n)));
  extras.forEach(n => defaultOrder.push(n));
  naturalOrder = defaultOrder;
  chartOrder = applySavedOrder(defaultOrder);
}
function parseAndDraw(text, fileName) {
  const rawData = {}, rawUnits = {};
  const tokens = text.replace(/^\uFEFF/, '').split(/[;\r\n]+/).map(t => t.replace(/"/g, '').trim());
  let i = 0, count = 0;
  while (i + 3 < tokens.length) {
    const ts = parseFloat(tokens[i].replace(',', '.'));
    const name = tokens[i + 1];
    if (!isNaN(ts) && name) {
      if (SKIP_PATTERNS.some(re => re.test(name))) { i += 4; continue; }
      const val = parseFloat(tokens[i + 2].replace(',', '.'));
      if (!isNaN(val)) {
        if (!rawData.hasOwnProperty(name)) { rawData[name] = []; rawUnits[name] = tokens[i + 3] || ''; }
        rawData[name].push({ x: ts, y: val });
        count++; i += 4; continue;
      }
    }
    i++;
  }
  if (!count) { document.getElementById('fileInfo').textContent = '⚠ параметры не найдены'; return; }
  classifyParams(rawData, rawUnits);
  let minT = Infinity, maxT = 0;
  for (const key in allData) {
    const arr = allData[key]; arr.sort((a, b) => a.x - b.x);
    for (let j = 0; j < arr.length; j++) { if (arr[j].x < minT) minT = arr[j].x; if (arr[j].x > maxT) maxT = arr[j].x; }
  }
  for (const key in allData) { const arr = allData[key]; for (let j = 0; j < arr.length; j++) arr[j].x -= minT; }
  totalTime = maxT - minT;
  wsSlider.max = Math.max(300, Math.ceil(totalTime));
  document.getElementById('empty').style.display = 'none';
  const totalParams = Object.keys(allData).filter(k => allData[k].length).length;
  document.getElementById('fileInfo').textContent = fileName + ' · ' + formatDur(totalTime) + ' · ' + count.toLocaleString('ru-RU') + ' точек · ' + totalParams + ' параметров';
  timePosition = 0; updateControls(); runAnalysis(); buildCharts(); renderAll();
}

function getRoleData(roleId) { const n = roleParams[roleId]; return n && n.length ? allData[n[0]] : null; }
function getRoleNames(roleId) { return roleParams[roleId] || []; }
function runAnalysis() {
  dangerRetards = []; throttleFlaps = []; turboEvents = []; knockEvents = [];
  const rpm = getRoleData('rpm'), knock = getRoleData('knockDetected');
  const speed = getRoleData('speed'), tps = getRoleData('throttle');
  const load = getRoleData('load'), boost = getRoleData('boost');
  if (rpm && rpm.length >= 2) {
    getRoleNames('uoz').forEach(uozName => { dangerRetards = dangerRetards.concat(detectRetards(uozName, rpm, tps, load, knock)); });
    dangerRetards.sort((a, b) => a.x - b.x);
    dangerRetards = dedup(dangerRetards, MERGE_RETARD);
  }
  if (tps && tps.length >= 3 && rpm && rpm.length >= 2) throttleFlaps = detectFlaps(getRoleNames('throttle')[0], tps, rpm);
  if (boost && boost.length >= 2 && tps && rpm && rpm.length >= 2) turboEvents = detectTurbo(getRoleNames('boost')[0], boost, tps, rpm);
  if (knock && knock.length >= 1) knockEvents = detectKnock(getRoleNames('knockDetected')[0], knock, rpm, speed);
  renderEventsPanel();
}
function detectRetards(uozName, rpm, tps, load, knock) {
  const uoz = allData[uozName], label = paramConfigs[uozName].shortName, out = [];
  let j = 0;
  for (let k = 0; k < uoz.length; k++) {
    const p = uoz[k];
    if (p.y >= 0) continue;
    const rpmAt = getValueAtTime(rpm, p.x);
    if (rpmAt === null || rpmAt <= MIN_RPM) continue;
    const tpsAt = tps ? getValueAtTime(tps, p.x) : null;
    if (tpsAt !== null && tpsAt < TPS_RELEASED) continue;
    if (load) { const l = getValueAtTime(load, p.x); if (l !== null && l < LOAD_MIN) continue; }
    while (j < rpm.length && rpm[j].x <= p.x) j++;
    const a = rpm[j], b = rpm[j + 1];
    if (!a || !b) continue;
    if (b.y < a.y - RPM_DROP_EPS) continue;
    const knockAt = knock ? getValueAtTime(knock, p.x) : null;
    out.push({
      x: p.x, y: p.y, rpm: Math.round(rpmAt),
      tps: tpsAt !== null ? Math.round(tpsAt) : null,
      load: load ? (() => { const l = getValueAtTime(load, p.x); return l !== null ? Math.round(l) : null; })() : null,
      wot: tpsAt !== null && tpsAt >= TPS_WOT,
      knockConfirmed: knockAt !== null && knockAt >= 0.5,
      label: label, target: uozName
    });
  }
  return out;
}
function detectFlaps(tpsName, tps, rpm) {
  const out = [];
  for (let k = 1; k < tps.length - 1; k++) {
    const a = tps[k-1], b = tps[k], c = tps[k+1];
    if (b.y < FLAP_ZONE[0] || b.y > FLAP_ZONE[1]) continue;
    const d1 = b.y - a.y, d2 = c.y - b.y;
    if (!((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))) continue;
    if (Math.abs(d1) < FLAP_AMP || Math.abs(d2) < FLAP_AMP) continue;
    const r0 = getValueAtTime(rpm, a.x), r1 = getValueAtTime(rpm, c.x);
    if (r0 === null || r1 === null || Math.min(r0, r1) <= MIN_RPM) continue;
    if (r1 >= r0 - FLAP_RPM_DROP) out.push({ x: b.x, y: b.y, target: tpsName });
  }
  return dedup(out, MERGE_FLAP);
}
function detectTurbo(boostName, boost, tps, rpm) {
  const out = [];
  for (let k = 1; k < boost.length; k++) {
    const p0 = boost[k-1], p1 = boost[k];
    const t1 = getValueAtTime(tps, p1.x), r1 = getValueAtTime(rpm, p1.x);
    if (t1 === null || r1 === null) continue;
    const delta = p1.y - p0.y;
    let kind = null;
    if (t1 >= TPS_WOT && r1 > TURBO_WOT_RPM && p1.y < TURBO_UNDERBOOST) kind = 'underboost';
    else if (delta < -TURBO_DELTA && t1 > TURBO_DROP_TPS) kind = 'drop';
    else if (delta > TURBO_DELTA) kind = 'spike';
    if (kind) out.push({ x: p1.x, y: p1.y, kind: kind, target: boostName });
  }
  return dedup(out, MERGE_TURBO);
}
function detectKnock(knockName, knock, rpm, speed) {
  const out = []; let prev = 0;
  for (let k = 0; k < knock.length; k++) {
    const p = knock[k], v = p.y >= 0.5 ? 1 : 0;
    if (v === 1 && prev === 0) {
      const rpmAt = rpm ? getValueAtTime(rpm, p.x) : null;
      const speedAt = speed ? getValueAtTime(speed, p.x) : null;
      out.push({ x: p.x, y: 1, rpm: rpmAt !== null ? Math.round(rpmAt) : null, speed: speedAt !== null ? Math.round(speedAt) : null, target: knockName });
    }
    prev = v;
  }
  return dedup(out, MERGE_KNOCK);
}
function dedup(events, gap) {
  const out = [];
  events.forEach(e => { const last = out[out.length-1]; if (last && (e.x - last.x) < gap && (!e.kind || e.kind === last.kind) && e.target === last.target) return; out.push(e); });
  return out;
}
const TURBO_LABELS = { underboost: 'недодув', drop: 'сброс наддува', spike: 'скачок наддува' };
function renderEventsPanel() {
  const panel = document.getElementById('eventsPanel'), list = document.getElementById('eventsList');
  const events = [];
  dangerRetards.forEach(e => {
    let text = 'откат ' + e.label + ' ' + formatValue(e.y) + '° @ ' + e.rpm + ' rpm';
    if (e.tps !== null) text += ' · ДПДЗ ' + e.tps + '%' + (e.wot ? ' (тапка!)' : '');
    if (e.load !== null) text += ' · нагр ' + e.load + '%';
    if (e.knockConfirmed) text += ' · ⚡детонация';
    events.push({ x: e.x, type: 'retard', target: e.target, text: text });
  });
  throttleFlaps.forEach(e => events.push({ x: e.x, type: 'flap', target: e.target, text: 'хлопание дросселя ' + formatValue(e.y) + '%' }));
  turboEvents.forEach(e => events.push({ x: e.x, type: 'turbo', target: e.target, text: TURBO_LABELS[e.kind] + ' ' + formatValue(e.y) + ' bar' }));
  knockEvents.forEach(e => {
    let text = '⚡ детонация';
    if (e.rpm !== null) text += ' @ ' + e.rpm + ' rpm';
    if (e.speed !== null) text += ' · ' + e.speed + ' km/h';
    events.push({ x: e.x, type: 'knock', target: e.target, text: text });
  });
  if (!events.length) { panel.style.display = 'none'; return; }
  events.sort((a, b) => a.x - b.x);
  panel.style.display = 'block'; panel.classList.remove('open');
  document.getElementById('eventsToggleHint').textContent = 'клик — развернуть';
  const parts = [];
  if (dangerRetards.length) parts.push('откатов: ' + dangerRetards.length);
  if (knockEvents.length) parts.push('детонация: ' + knockEvents.length);
  if (throttleFlaps.length) parts.push('хлопков: ' + throttleFlaps.length);
  if (turboEvents.length) parts.push('турбо: ' + turboEvents.length);
  document.getElementById('eventsCount').textContent = events.length + (parts.length ? '  (' + parts.join(', ') + ')' : '');
  list.innerHTML = '';
  const shown = events.slice(0, MAX_CHIPS);
  shown.forEach(ev => {
    const chip = document.createElement('button');
    chip.className = 'event-chip' + (ev.type !== 'retard' ? ' ' + ev.type : '');
    chip.innerHTML = '<span class="ev-dot"></span><span class="ev-time">' + ev.x.toFixed(1) + 's</span>' + ev.text;
    chip.addEventListener('click', () => jumpToEvent(ev));
    list.appendChild(chip);
  });
  if (events.length > MAX_CHIPS) {
    const note = document.createElement('span');
    note.className = 'events-more';
    note.textContent = '+ ещё ' + (events.length - MAX_CHIPS) + ' событий';
    list.appendChild(note);
  }
}
function jumpToEvent(ev) {
  const maxPos = Math.max(0, totalTime - windowSize);
  timePosition = Math.max(0, Math.min(maxPos, ev.x - windowSize / 3));
  pendingFlash = ev.target;
  updateControls(); scheduleRender();
}
function getConfig(name) { return paramConfigs[name] || { name: name, shortName: name, unit: '', color: '#9AA0A6', role: 'extra' }; }

function buildCharts() {
  const container = document.getElementById('charts');
  container.innerHTML = '';
  chartEls = [];
  chartOrder.forEach(name => {
    const pts = allData[name];
    if (!pts || pts.length < 2) return;
    const param = getConfig(name);
    const box = document.createElement('div'); box.className = 'chart-box'; box.dataset.name = name;
    const wrapper = document.createElement('div'); wrapper.className = 'canvas-wrapper';
    box.appendChild(wrapper); container.appendChild(box);
    const W = wrapper.clientWidth || 800;
    const canvas = document.createElement('canvas'); canvas.className = 'main-canvas';
    canvas.width = W * dpr; canvas.height = CHART_H * dpr; canvas.style.height = CHART_H + 'px';
    const overlay = document.createElement('canvas'); overlay.className = 'overlay';
    overlay.width = W * dpr; overlay.height = CHART_H * dpr; overlay.style.height = CHART_H + 'px';
    wrapper.appendChild(canvas); wrapper.appendChild(overlay);
    const mm = minMax(pts);
    const el = {
      name, param, box, canvas, overlay,
      total: pts.length, fullMin: mm.min, fullMax: mm.max, wholeMax: mm.max,
      pts: [], tStart: 0, tEnd: 0, avgInterval: 0, yMin: 0, yMax: 0, fixed: false
    };
    attachChartListeners(el);
    chartEls.push(el);
  });
  renderAll();
}
function attachChartListeners(el) {
  const canvas = el.canvas, box = el.box;
  canvas.addEventListener('mousemove', e => {
    if (dragState && dragState.dragging) return;
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    updateOverlay();
  });
  canvas.addEventListener('mouseleave', () => { mouseX = -1; updateOverlay(); });
  canvas.addEventListener('touchstart', onChartTouchStart, { passive: true });
  canvas.addEventListener('touchmove', onChartTouchMove, { passive: false });
  canvas.addEventListener('touchend', onChartTouchEnd);
  canvas.addEventListener('touchcancel', () => { chartTouch = null; });
  // Перетаскивание: Pointer Events — работает мышью и трекпадом Mac (pointerType "mouse").
  box.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (e.pointerType === 'touch') return;
    dragState = { box: box, startY: e.clientY, dragging: false, id: e.pointerId };
  });
}

// Глобальные обработчики перетаскивания (захват указателя)
window.addEventListener('pointermove', e => {
  if (!dragState || e.pointerId !== dragState.id) return;
  const box = dragState.box;
  if (!dragState.dragging) {
    if (Math.abs(e.clientY - dragState.startY) > 6) {
      dragState.dragging = true;
      try { box.setPointerCapture(dragState.id); } catch(_){}
      box.classList.add('dragging');
      document.body.classList.add('is-dragging');
      mouseX = -1; updateOverlay();
    } else return;
  }
  e.preventDefault();
  const container = document.getElementById('charts');
  const boxes = Array.from(container.querySelectorAll('.chart-box'));
  let target = null;
  for (let i = 0; i < boxes.length; i++) {
    if (boxes[i] === box) continue;
    const r = boxes[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { target = boxes[i]; break; }
  }
  if (target) container.insertBefore(box, target);
  else container.appendChild(box);
});
function endPointerDrag(e) {
  if (!dragState) return;
  if (e && e.pointerId !== undefined && e.pointerId !== dragState.id) return;
  const box = dragState.box;
  if (dragState.dragging) {
    box.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    saveOrder();
  }
  try { box.releasePointerCapture(dragState.id); } catch(_){}
  dragState = null;
}
window.addEventListener('pointerup', endPointerDrag);
window.addEventListener('pointercancel', endPointerDrag);
window.addEventListener('blur', () => endPointerDrag(null));

function renderAll() {
  const tStart = timePosition, tEnd = timePosition + windowSize;
  const fixed = document.getElementById('fixedScale').checked;
  for (let i = 0; i < chartEls.length; i++) renderChart(chartEls[i], tStart, tEnd, fixed);
}
function renderChart(el, tStart, tEnd, fixed) {
  const all = allData[el.name];
  el.tStart = tStart; el.tEnd = tEnd; el.fixed = fixed;
  const visiblePts = sliceRange(all, tStart, tEnd);
  const extendedPts = [];
  const sv = getValueAtTime(all, tStart);
  if (sv !== null) extendedPts.push({ x: tStart, y: sv, isBoundary: true });
  for (let i = 0; i < visiblePts.length; i++) extendedPts.push(visiblePts[i]);
  const ev = getValueAtTime(all, tEnd);
  if (ev !== null) extendedPts.push({ x: tEnd, y: ev, isBoundary: true });
  el.pts = extendedPts;
  el.avgInterval = visiblePts.length > 1 ? (visiblePts[visiblePts.length-1].x - visiblePts[0].x) / (visiblePts.length - 1) : 0;
  let yMin, yMax;
  if (fixed) {
    yMin = el.param.minVal !== undefined ? el.param.minVal : el.fullMin;
    yMax = el.param.maxVal !== undefined ? el.param.maxVal : el.fullMax;
  } else {
    const mm = minMax(extendedPts.length ? extendedPts : visiblePts);
    yMin = mm.min; yMax = mm.max;
  }
  if (el.param.anomaly) { yMin = Math.min(yMin, el.param.anomaly[0]); yMax = Math.max(yMax, el.param.anomaly[1]); }
  el.yMin = yMin; el.yMax = yMax;
  drawChart(el);
}

function lowerBound(pts, x) {
  let lo = 0, hi = pts.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].x < x) lo = mid + 1; else hi = mid; }
  return lo;
}
function sliceRange(pts, tStart, tEnd) {
  const i0 = lowerBound(pts, tStart);
  const i1 = lowerBound(pts, tEnd + 1e-9);
  return pts.slice(i0, i1);
}
function decimateForDraw(pts, maxPoints) {
  const n = pts.length;
  if (n <= maxPoints) return pts;
  const out = [pts[0]];
  const bucketCount = Math.max(1, Math.floor(maxPoints / 2));
  const bucketSize = (n - 2) / bucketCount;
  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(1 + b * bucketSize);
    const end = Math.min(n - 1, Math.floor(1 + (b + 1) * bucketSize));
    if (end <= start) continue;
    let minIdx = start, maxIdx = start;
    for (let k = start; k < end; k++) {
      if (pts[k].y < pts[minIdx].y) minIdx = k;
      if (pts[k].y > pts[maxIdx].y) maxIdx = k;
    }
    if (minIdx === maxIdx) out.push(pts[minIdx]);
    else if (minIdx < maxIdx) { out.push(pts[minIdx]); out.push(pts[maxIdx]); }
    else { out.push(pts[maxIdx]); out.push(pts[minIdx]); }
  }
  out.push(pts[n - 1]);
  return out;
}

function getScale(el, W, H) {
  const pad = { l: 58, r: 10, t: 24, b: 18 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const yRange = (el.yMax - el.yMin) || 1, yPad = yRange * 0.06;
  const tickMin = el.fixed ? el.yMin : el.yMin - yPad, tickMax = el.fixed ? el.yMax : el.yMax + yPad;
  const yTicks = getNiceTicks(tickMin, tickMax, 5);
  const dYMin = yTicks[0], dYMax = yTicks[yTicks.length - 1];
  return { pad, pw, ph, yTicks, dYMin, dYMax, dYRange: (dYMax - dYMin) || 1 };
}
function getDangerForChart(param, tStart, tEnd) {
  if (param.retardChart && dangerRetards.length) return { list: dangerRetards.filter(e => e.target === param.name && e.x >= tStart && e.x <= tEnd), color: '#FF1744', glow: 'rgba(255,23,68,.28)', badge: 'откат' };
  if (param.flapChart && throttleFlaps.length) return { list: throttleFlaps.filter(e => e.target === param.name && e.x >= tStart && e.x <= tEnd), color: '#FFAB00', glow: 'rgba(255,171,0,.28)', badge: 'хлопание' };
  if (param.turboChart && turboEvents.length) return { list: turboEvents.filter(e => e.target === param.name && e.x >= tStart && e.x <= tEnd), color: '#40C4FF', glow: 'rgba(64,196,255,.28)', badge: 'турбо' };
  if (param.knockChart && knockEvents.length) return { list: knockEvents.filter(e => e.target === param.name && e.x >= tStart && e.x <= tEnd), color: '#FF1744', glow: 'rgba(255,23,68,.28)', badge: 'детонация', isKnock: true };
  return null;
}
function dangerLabel(d, e) {
  if (d.badge === 'откат') return 'откат!';
  if (d.badge === 'хлопание') return 'хлопок';
  if (d.badge === 'детонация') return 'детонация';
  return TURBO_LABELS[e.kind] || 'турбо';
}
function drawChart(el) {
  const { canvas, param, pts, total, tStart, tEnd, avgInterval, wholeMax } = el;
  const ctx = canvas.getContext('2d');
  ctx.save(); ctx.scale(dpr, dpr);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const s = getScale(el, W, H);
  const { pad, pw, ph, yTicks, dYMin, dYMax, dYRange } = s;
  const xTicks = getNiceTicks(tStart, tEnd, Math.max(4, Math.min(10, Math.round(pw / 140))));
  ctx.fillStyle = '#161b22'; ctx.fillRect(0, 0, W, H);

  const isNarrow = W < 520;
  const titleFont = (isNarrow ? '700 12.5px ' : '700 15px ') + SANS;
  const statsFont = (isNarrow ? '11.5px ' : '13.5px ') + MONO;
  const badgeFont = (isNarrow ? '700 10px ' : '700 11px ') + MONO;

  const danger = getDangerForChart(param, tStart, tEnd);
  const realPts = pts.filter(p => !p.isBoundary);
  const fullCoverage = realPts.length === total && total > 0;
  let stats = realPts.length + '/' + total + ' ' + plural(realPts.length);
  if (avgInterval > 0) stats += ' · Δt ' + avgInterval.toFixed(2) + 's';
  if (realPts.length) { const mm = minMax(realPts); stats += ' · ' + formatValue(mm.min) + '…' + formatValue(mm.max); }
  let nAnom = 0;
  if (param.anomaly && realPts.length) { const [lo, hi] = param.anomaly; nAnom = realPts.reduce((n, p) => n + ((p.y < lo || p.y > hi) ? 1 : 0), 0); }

  ctx.font = statsFont;
  const statsW = ctx.measureText(stats).width;
  const anomW = nAnom ? ctx.measureText('⚠' + nAnom).width + 8 : 0;
  let bText = null, badgeW = 0;
  if (danger && danger.list.length) {
    bText = '⚠ ' + danger.badge + ': ' + danger.list.length;
    ctx.font = badgeFont;
    badgeW = ctx.measureText(bText).width + 16 + 10;
  }
  const rightW = statsW + anomW + badgeW;

  ctx.fillStyle = param.color; ctx.fillRect(8, 4.5, 4, 13);
  const titleAvail = Math.max(36, W - 8 - rightW - 17 - 8);
  const titleStr = fitText(ctx, param.name, titleFont, titleAvail);
  ctx.font = titleFont; ctx.textAlign = 'left'; ctx.fillStyle = '#e2e8f0';
  ctx.fillText(titleStr, 17, 16);
  const titleW = ctx.measureText(titleStr).width;
  if (param.unit && 17 + titleW + 8 + 26 <= W - 8 - rightW) {
    ctx.font = (isNarrow ? '10px ' : '11px ') + MONO; ctx.fillStyle = '#75808e';
    ctx.fillText(param.unit, 17 + titleW + 6, 16);
  }

  let rightX = W - 8;
  if (bText) {
    ctx.font = badgeFont;
    const bw = ctx.measureText(bText).width + 16, bx = rightX - bw;
    ctx.fillStyle = 'rgba(10,13,17,.85)'; ctx.beginPath(); rrPath(ctx, bx, 3.5, bw, 17, 5); ctx.fill();
    ctx.strokeStyle = danger.color; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = danger.color; ctx.textAlign = 'center'; ctx.fillText(bText, bx + bw / 2, 16);
    rightX = bx - 10;
  }
  ctx.font = statsFont; ctx.textAlign = 'right';
  ctx.fillStyle = fullCoverage ? '#9fd8a4' : '#7d9b80';
  ctx.fillText(stats, rightX, 16);
  if (nAnom) { ctx.fillStyle = '#FF5252'; ctx.fillText('⚠' + nAnom, rightX - statsW - 8, 16); }

  ctx.font = (isNarrow ? '11px ' : '13px ') + MONO;
  yTicks.forEach(v => {
    const y = pad.t + ph * (1 - (v - dYMin) / dYRange);
    ctx.strokeStyle = 'rgba(255,255,255,.055)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = '#8a95a5'; ctx.textAlign = 'right'; ctx.fillText(tickLabel(v), pad.l - 6, y + 4);
  });
  ctx.font = (isNarrow ? '9.5px ' : '10.5px ') + MONO;
  xTicks.forEach(v => {
    const x = pad.l + pw * (v - tStart) / (tEnd - tStart);
    if (x < pad.l - 1 || x > W - pad.r + 1) return;
    ctx.strokeStyle = 'rgba(255,255,255,.045)';
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
    ctx.fillStyle = '#8a95a5'; ctx.textAlign = 'center';
    ctx.fillText((v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + 's', x, H - 5);
  });

  if (param.zeroLine && dYMin < 0 && dYMax > 0) {
    const y0 = pad.t + ph * (1 - (0 - dYMin) / dYRange);
    ctx.strokeStyle = 'rgba(255,82,82,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, y0); ctx.lineTo(W - pad.r, y0); ctx.stroke(); ctx.setLineDash([]);
  }
  if (param.anomaly) {
    ctx.strokeStyle = 'rgba(255,82,82,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    param.anomaly.forEach(v => { if (v >= dYMin && v <= dYMax) { const y = pad.t + ph * (1 - (v - dYMin) / dYRange); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); } });
    ctx.setLineDash([]);
  }
  if (param.alertLine !== undefined && wholeMax >= param.alertLine && dYMin <= param.alertLine && dYMax >= param.alertLine) {
    const ya = pad.t + ph * (1 - (param.alertLine - dYMin) / dYRange);
    ctx.strokeStyle = 'rgba(255,82,82,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, ya); ctx.lineTo(W - pad.r, ya); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '700 10px ' + MONO; ctx.fillStyle = '#FF8A80'; ctx.textAlign = 'right';
    ctx.fillText('⚠ ' + param.alertLine + (param.unit || ''), W - pad.r - 4, ya - 4);
  }

  const drawPts = decimateForDraw(pts, Math.max(300, Math.floor(pw * 2)));
  ctx.strokeStyle = param.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.beginPath();
  for (let i = 0; i < drawPts.length; i++) {
    const p = drawPts[i];
    const x = pad.l + pw * (p.x - tStart) / (tEnd - tStart);
    const y = pad.t + ph * (1 - (p.y - dYMin) / dYRange);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  const firstX = pad.l + pw * (drawPts[0].x - tStart) / (tEnd - tStart);
  const lastX = pad.l + pw * (drawPts[drawPts.length-1].x - tStart) / (tEnd - tStart);
  ctx.lineTo(lastX, pad.t + ph); ctx.lineTo(firstX, pad.t + ph); ctx.closePath();
  ctx.fillStyle = param.color + '1f'; ctx.fill();

  if (realPts.length && realPts.length <= 1500) {
    const baseR = realPts.length > 500 ? 2.3 : 3;
    realPts.forEach(p => {
      const x = pad.l + pw * (p.x - tStart) / (tEnd - tStart);
      const y = pad.t + ph * (1 - (p.y - dYMin) / dYRange);
      let fill = param.color, stroke = '#0e1116', r = baseR;
      const isAnomaly = param.anomaly && (p.y < param.anomaly[0] || p.y > param.anomaly[1]);
      if (isAnomaly) { fill = param.anomalyColor; stroke = '#fff'; r = baseR + 1.5; ctx.fillStyle = fill + '3d'; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI*2); ctx.fill(); }
      else if (param.negColor && p.y < 0) { fill = param.negColor; stroke = '#fff'; }
      ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    });
  }
  if (danger && danger.list.length && !param.knockChart) {
    danger.list.forEach(e => {
      const x = pad.l + pw * (e.x - tStart) / (tEnd - tStart);
      const y = pad.t + ph * (1 - (e.y - dYMin) / dYRange);
      ctx.fillStyle = danger.glow; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI*2); ctx.fill();
      if (e.knockConfirmed) { ctx.strokeStyle = '#FFD600'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 8.5, 0, Math.PI*2); ctx.stroke(); }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = danger.color; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2); ctx.fill();
    });
    if (danger.list.length <= 8) {
      ctx.font = '700 10.5px ' + SANS; ctx.textAlign = 'center';
      danger.list.forEach(e => {
        const x = pad.l + pw * (e.x - tStart) / (tEnd - tStart);
        const y = pad.t + ph * (1 - (e.y - dYMin) / dYRange);
        const ly = (y - 14 < pad.t + 10) ? y + 22 : y - 14;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,13,17,.85)';
        ctx.strokeText(dangerLabel(danger, e), x, ly);
        ctx.fillStyle = danger.color; ctx.fillText(dangerLabel(danger, e), x, ly);
      });
    }
  }
  if (param.knockChart && danger && danger.list.length && danger.list.length <= 8) {
    ctx.font = '700 10.5px ' + SANS; ctx.textAlign = 'center';
    danger.list.forEach(e => {
      const x = pad.l + pw * (e.x - tStart) / (tEnd - tStart);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,13,17,.85)';
      ctx.strokeText('детонация', x, pad.t + 12);
      ctx.fillStyle = '#FF1744'; ctx.fillText('детонация', x, pad.t + 12);
    });
  }
  ctx.restore();
}

function updateOverlay() {
  for (let i = 0; i < chartEls.length; i++) {
    const el = chartEls[i];
    const { overlay, param, pts, tStart, tEnd } = el;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (mouseX < 0) continue;
    ctx.save(); ctx.scale(dpr, dpr);
    const W = overlay.clientWidth, H = overlay.clientHeight;
    const s = getScale(el, W, H);
    const { pad, pw, ph, dYMin, dYRange } = s;
    if (mouseX >= pad.l && mouseX <= W - pad.r) {
      const time = tStart + (mouseX - pad.l) / pw * (tEnd - tStart);
      ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(mouseX, pad.t); ctx.lineTo(mouseX, pad.t + ph); ctx.stroke(); ctx.setLineDash([]);
      const value = getValueAtTime(pts, time);
      if (value !== null) {
        const y = pad.t + ph * (1 - (value - dYMin) / dYRange);
        let ptColor = param.color;
        if (param.anomaly && (value < param.anomaly[0] || value > param.anomaly[1])) ptColor = param.anomalyColor;
        else if (param.negColor && value < 0) ptColor = param.negColor;
        else if (param.knockChart && value >= 0.5) ptColor = '#FF1744';
        ctx.fillStyle = ptColor; ctx.beginPath(); ctx.arc(mouseX, y, 4.5, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        const label = time.toFixed(1) + 's · ' + formatValue(value) + (param.unit ? ' ' + param.unit : '');
        ctx.font = '700 11.5px ' + SANS;
        const tw = ctx.measureText(label).width;
        let lx = mouseX + 9, ly = y - 8;
        if (lx + tw + 10 > W - pad.r) lx = mouseX - tw - 19;
        if (ly < pad.t + 12) ly = y + 18;
        ctx.fillStyle = 'rgba(10,13,17,.92)'; ctx.strokeStyle = ptColor; ctx.lineWidth = 1;
        ctx.beginPath(); rrPath(ctx, lx - 5, ly - 11, tw + 10, 17, 3); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(label, lx, ly + 1);
      }
    }
    ctx.restore();
  }
}

function minMax(arr) { let min = Infinity, max = -Infinity; for (let i = 0; i < arr.length; i++) { const v = arr[i].y; if (v < min) min = v; if (v > max) max = v; } return { min, max }; }
function getValueAtTime(pts, time) {
  const n = pts.length;
  if (!n) return null;
  if (time <= pts[0].x) return pts[0].y;
  if (time >= pts[n-1].x) return pts[n-1].y;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].x <= time) lo = mid; else hi = mid; }
  const dx = pts[hi].x - pts[lo].x;
  if (dx <= 0) return pts[hi].y;
  return pts[lo].y + ((time - pts[lo].x) / dx) * (pts[hi].y - pts[lo].y);
}
function fitText(ctx, text, font, maxWidth) {
  ctx.font = font;
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}
function rrPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function plural(n) { const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return 'точка'; if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'точки'; return 'точек'; }
function formatValue(v) { const a = Math.abs(v); if (a < 0.01) return '0'; if (a >= 100) return v.toFixed(0); if (a >= 1) return v.toFixed(1); return v.toFixed(2); }
function tickLabel(v) { if (Math.abs(v) < 1e-9) return '0'; const a = Math.abs(v); if (a >= 100) return v.toFixed(0); if (a >= 1) return String(Math.round(v * 10) / 10); return String(Math.round(v * 100) / 100); }
function formatDur(t) { return t >= 60 ? Math.floor(t / 60) + 'м ' + Math.round(t % 60) + 'с' : t.toFixed(0) + 'с'; }
function formatWin(s) { s = Math.round(s); return s >= 60 ? Math.floor(s / 60) + 'м ' + (s % 60) + 'с' : s + 'с'; }
function niceNum(range, round) { const exp = Math.floor(Math.log10(range)); const frac = range / Math.pow(10, exp); let nice; if (round) nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10; else nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10; return nice * Math.pow(10, exp); }
function getNiceTicks(min, max, target) { if (min === max) return [min]; const range = niceNum(max - min, false); const spacing = niceNum(range / (target - 1), true); const nMin = Math.floor(min / spacing) * spacing; const nMax = Math.ceil(max / spacing) * spacing; const ticks = []; for (let v = nMin; v <= nMax + 0.5 * spacing; v += spacing) ticks.push(parseFloat(v.toFixed(10))); return ticks; }

(function init() {
  const sw = parseFloat(loadSetting('windowSize'));
  if (!isNaN(sw) && sw >= 5) windowSize = sw;
  if (loadSetting('fixedScale') === '1') document.getElementById('fixedScale').checked = true;
  updateControls();
})();