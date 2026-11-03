/* 나의하루 — 시간대별 슈퍼앱 (1단계) */
'use strict';

const KEY = 'naui-haru-v1';
const JAMSIL = { lat: 37.5133, lon: 127.1001, name: '잠실' };

const DEFAULT_BANDS = [
  { id: 'dawn', label: '새벽', start: '04:30' },
  { id: 'commute', label: '출근길', start: '07:00' },
  { id: 'work', label: '회사', start: '08:20' },
  { id: 'after', label: '퇴근 후', start: '18:00' },
  { id: 'evening', label: '저녁', start: '20:00' },
  { id: 'night', label: '취침', start: '22:00' },
];
const WEEKEND = { id: 'weekend', label: '주말' };

const DEFAULT_STATE = {
  settings: {
    name: '',
    bands: DEFAULT_BANDS,
    workStart: '08:20',
    workHours: 9.5,
    diaryUrl: '',
    barotaUrl: 'https://barota-five.vercel.app/',
    newsKeywords: '투자, AI, 창업',
    habits: '새벽기도, 운동, 토리 산책, 감사일기, 블로그',
  },
  days: {},
  todos: [],
  memos: [],
  workouts: [],
};

/* ---------- storage ---------- */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const s = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...s,
      settings: { ...DEFAULT_STATE.settings, ...(s.settings || {}) },
    };
  } catch { return structuredClone(DEFAULT_STATE); }
}
let state = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

/* ---------- time helpers ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(((m % 60) + 60) % 60)}`;
const nowMin = d => d.getHours() * 60 + d.getMinutes();
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;
const koTime = d => {
  const h = d.getHours(), m = d.getMinutes();
  const ap = h < 6 ? '새벽' : h < 12 ? '오전' : h < 18 ? '오후' : h < 21 ? '저녁' : '밤';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${h12}시${m ? ` ${m}분` : ''}`;
};

function today() {
  const k = ymd(new Date());
  if (!state.days[k]) state.days[k] = { prayer: false, praise: false, word: '', habits: {}, tori: { am: false, pm: false }, diary: false, blog: false };
  return state.days[k];
}

/* Which band is it now? */
function currentBand(d = new Date()) {
  const bands = state.settings.bands;
  const m = nowMin(d);
  let cur = bands[bands.length - 1]; // before first start → still "night"
  for (const b of bands) if (m >= toMin(b.start)) cur = b;
  if (isWeekend(d) && ['commute', 'work', 'after'].includes(cur.id)) return WEEKEND;
  return cur;
}

/* Cards shown first for each band */
const BAND_CARDS = {
  dawn: ['prayer', 'weather', 'todo'],
  commute: ['barota', 'weather', 'news', 'memo'],
  work: ['countdown', 'todo', 'memo'],
  after: ['workout', 'tori', 'barota'],
  evening: ['diary', 'memo', 'tori'],
  night: ['habits', 'todo', 'diary'],
  weekend: ['weather', 'workout', 'tori', 'diary'],
};
const ALL_CARDS = ['prayer', 'weather', 'barota', 'countdown', 'todo', 'memo', 'workout', 'tori', 'diary', 'habits', 'news'];
const GREET = {
  dawn: '새벽을 여는 시간', commute: '출근길, 오늘도 힘내요', work: '집중하는 시간',
  after: '수고했어요, 이제 내 시간', evening: '하루를 적는 시간', night: '내일을 준비하는 시간', weekend: '쉼이 있는 주말',
};

let selectedBand = null; // user preview
const expanded = new Set();

/* ---------- cards ---------- */
const cards = {
  prayer() {
    const t = today();
    const streak = streakOf(d => d.prayer);
    return `
      <h3>새벽기도 · 말씀 <span class="sub">${streak ? `${streak}일 연속` : ''}</span></h3>
      <div class="chips">
        <button class="chip ${t.prayer ? 'on' : ''}" data-act="toggleDay" data-k="prayer">🙏 새벽기도</button>
        <button class="chip ${t.praise ? 'on' : ''}" data-act="toggleDay" data-k="praise">♪ 찬양</button>
      </div>
      <p class="muted">오늘의 말씀 · 묵상 한 줄</p>
      <textarea data-input="word" placeholder="예: 열왕기상 19장 — 다시 찾아오신 천사">${esc(t.word || '')}</textarea>`;
  },

  weather() {
    const w = weatherCache;
    if (!w) return `<h3>날씨 <span class="sub">${JAMSIL.name}</span></h3><p class="muted">불러오는 중…</p>`;
    if (w.error) return `<h3>날씨 <span class="sub">${JAMSIL.name}</span></h3><p class="muted">날씨를 불러오지 못했어요. <button class="btn" data-act="reloadWeather">다시</button></p>`;
    const pm = pmGrade(w.pm25, w.pm10);
    return `
      <h3>날씨 <span class="sub">${JAMSIL.name} · ${w.at}</span></h3>
      <div class="row gap"><p class="big">${Math.round(w.temp)}°</p><div><p style="margin:0">${w.desc}</p><p class="muted" style="margin:0">최저 ${Math.round(w.min)}° · 최고 ${Math.round(w.max)}°</p></div></div>
      <div class="stats">
        <div><b>${w.pop ?? '-'}%</b><span>오늘 강수확률</span></div>
        <div><b class="${pm.cls}">${pm.label}</b><span>미세먼지 ${w.pm10 ?? '-'} · 초미세 ${w.pm25 ?? '-'}</span></div>
        <div><b>${Math.round(w.feels)}°</b><span>체감</span></div>
      </div>`;
  },

  barota() {
    const m = nowMin(new Date());
    const mode = m < toMin('12:00') ? '출근' : '퇴근';
    return `
      <h3>지하철 <span class="sub">바로타</span></h3>
      <a class="link-btn" href="${esc(state.settings.barotaUrl)}" target="_blank" rel="noopener">
        <span>${mode} 열차 도착 보기</span><strong>바로타 열기 →</strong></a>`;
  },

  countdown() {
    const t = today();
    const start = t.workStart || state.settings.workStart;
    const end = toMin(start) + Math.round(state.settings.workHours * 60);
    const m = nowMin(new Date());
    const left = end - m;
    const pct = Math.min(100, Math.max(0, ((m - toMin(start)) / (end - toMin(start))) * 100));
    const leftTxt = left > 0 ? `${Math.floor(left / 60)}시간 ${left % 60}분` : '퇴근 시간!';
    return `
      <h3>퇴근까지 <span class="sub">출근 ${start} · 퇴근 ${fromMin(end)}</span></h3>
      <p class="big ${left <= 0 ? 'good' : ''}" id="cdLeft">${leftTxt}</p>
      <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="row gap wrap" style="margin-top:10px">
        <button class="btn" data-act="arriveNow">지금 도착했어요</button>
        ${t.workStart ? `<button class="btn" data-act="resetArrive">기본(${state.settings.workStart})으로</button>` : ''}
      </div>`;
  },

  todo() {
    const k = ymd(new Date());
    const list = state.todos.filter(x => !x.done || x.doneDate === k);
    const open = list.filter(x => !x.done).length;
    return `
      <h3>할 일 <span class="sub">${open ? `${open}개 남음` : '모두 끝!'}</span></h3>
      <ul class="list">${list.map(x => `
        <li class="${x.done ? 'done' : ''}">
          <input type="checkbox" data-act="toggleTodo" data-id="${x.id}" ${x.done ? 'checked' : ''} aria-label="완료">
          <span class="txt">${esc(x.text)}${x.date !== k && !x.done ? ` <span class="muted">· ${x.date.slice(5)}부터</span>` : ''}</span>
          <button class="x" data-act="delTodo" data-id="${x.id}" aria-label="삭제">×</button>
        </li>`).join('')}</ul>
      <form class="addrow" data-form="todo"><input name="t" placeholder="할 일 추가" autocomplete="off"><button class="btn">추가</button></form>`;
  },

  memo() {
    const list = state.memos.slice(0, 5);
    return `
      <h3>메모 <span class="sub">${state.memos.length}개</span></h3>
      <ul class="list">${list.map(x => `
        <li><span class="txt">${esc(x.text)} <span class="muted">· ${x.at}</span></span>
        <button class="x" data-act="delMemo" data-id="${x.id}" aria-label="삭제">×</button></li>`).join('') || '<li class="muted">떠오른 생각을 바로 적어 두세요.</li>'}</ul>
      <form class="addrow" data-form="memo"><input name="t" placeholder="한 줄 메모" autocomplete="off"><button class="btn">저장</button></form>`;
  },

  workout() {
    const k = ymd(new Date());
    const weekAgo = ymd(new Date(Date.now() - 6 * 864e5));
    const week = state.workouts.filter(x => x.date >= weekAgo);
    const sum = type => week.filter(x => x.type === type).reduce((a, x) => a + (+x.km || 0), 0);
    const todayList = state.workouts.filter(x => x.date === k);
    return `
      <h3>운동 기록 <span class="sub">최근 7일</span></h3>
      <div class="stats">
        <div><b>${sum('달리기').toFixed(1)}km</b><span>달리기</span></div>
        <div><b>${sum('수영').toFixed(1)}km</b><span>수영</span></div>
        <div><b>${week.length}회</b><span>운동</span></div>
      </div>
      <ul class="list">${todayList.map(x => `<li><span class="txt">오늘 ${esc(x.type)} ${x.km ? `${x.km}km` : ''} ${x.min ? `${x.min}분` : ''} ${pace(x)}</span>
        <button class="x" data-act="delWorkout" data-id="${x.id}" aria-label="삭제">×</button></li>`).join('')}</ul>
      <form class="addrow" data-form="workout">
        <select name="type"><option>달리기</option><option>수영</option><option>걷기</option><option>자전거</option><option>헬스</option></select>
        <input name="km" inputmode="decimal" placeholder="km" style="max-width:72px">
        <input name="min" inputmode="numeric" placeholder="분" style="max-width:64px">
        <button class="btn">기록</button>
      </form>`;
  },

  tori() {
    const t = today();
    return `
      <h3>토리 산책 <span class="sub">${t.tori.am || t.tori.pm ? '오늘 했어요' : '아직'}</span></h3>
      <div class="chips">
        <button class="chip ${t.tori.am ? 'on' : ''}" data-act="toggleTori" data-k="am">🐕 아침·낮</button>
        <button class="chip ${t.tori.pm ? 'on' : ''}" data-act="toggleTori" data-k="pm">🌙 저녁·밤</button>
      </div>`;
  },

  diary() {
    const t = today();
    const url = state.settings.diaryUrl;
    return `
      <h3>감사일기 <span class="sub">${t.diary ? '오늘 썼어요 ✓' : '오늘 아직'}</span></h3>
      <p class="muted">지금 시각으로 시작하기 — <b id="koNow">${koTime(new Date())}</b>
        <button class="btn" data-act="copyTime" style="padding:4px 10px;margin-left:4px">복사</button></p>
      ${url ? `<a class="link-btn" href="${esc(url)}" target="_blank" rel="noopener"><span>Google Docs 감사일기</span><strong>열기 →</strong></a>`
             : `<p class="muted">설정에서 감사일기 Google Docs 주소를 넣어 주세요.</p>`}
      <div class="chips" style="margin-top:10px">
        <button class="chip ${t.diary ? 'on' : ''}" data-act="toggleDay" data-k="diary">✍︎ 오늘 썼어요</button>
        <button class="chip ${t.blog ? 'on' : ''}" data-act="toggleDay" data-k="blog">📝 블로그 1편</button>
      </div>`;
  },

  habits() {
    const names = habitNames();
    const days = [...Array(7)].map((_, i) => ymd(new Date(Date.now() - (6 - i) * 864e5)));
    const k = ymd(new Date());
    const done = names.filter(n => habitDone(n, k)).length;
    return `
      <h3>오늘의 습관 정산 <span class="sub">${done}/${names.length}</span></h3>
      <ul class="list">${names.map(n => `
        <li><input type="checkbox" data-act="toggleHabit" data-k="${esc(n)}" ${habitDone(n, k) ? 'checked' : ''} ${autoHabit(n) ? 'disabled title="자동 체크"' : ''}>
        <span class="txt">${esc(n)}</span>
        <span class="muted" aria-label="최근 7일">${days.map(d => habitDone(n, d) ? '●' : '○').join('')}</span></li>`).join('')}</ul>
      <p class="muted">새벽기도·운동·토리 산책·감사일기·블로그는 다른 카드에서 기록하면 자동으로 체크돼요.</p>`;
  },

  news() {
    const n = newsCache;
    const kws = state.settings.newsKeywords;
    if (!n) return `<h3>뉴스 <span class="sub">${esc(kws)}</span></h3><p class="muted">불러오는 중…</p>`;
    if (n.error) return `<h3>뉴스 <span class="sub">${esc(kws)}</span></h3><p class="muted">뉴스를 불러오지 못했어요.</p>`;
    return `
      <h3>뉴스 <span class="sub">${esc(kws)}</span></h3>
      <ul class="list news">${n.items.slice(0, 6).map(x => `<li><a href="${esc(x.link)}" target="_blank" rel="noopener"><span class="txt">${esc(x.title)}</span><br><span class="src">${esc(x.kw)} · ${esc(x.source || '')}</span></a></li>`).join('')}</ul>`;
  },
};

function pace(x) {
  if (!x.km || !x.min) return '';
  if (x.type === '달리기' || x.type === '걷기') { const p = x.min / x.km; return `· ${Math.floor(p)}'${pad(Math.round((p % 1) * 60))}"/km`; }
  return '';
}
function habitNames() { return state.settings.habits.split(',').map(s => s.trim()).filter(Boolean); }
function autoHabit(n) { return /기도|운동|토리|산책|일기|블로그/.test(n); }
function habitDone(n, k) {
  const d = state.days[k];
  if (/기도/.test(n)) return !!d?.prayer;
  if (/운동/.test(n)) return state.workouts.some(w => w.date === k);
  if (/토리|산책/.test(n)) return !!(d?.tori?.am || d?.tori?.pm);
  if (/일기/.test(n)) return !!d?.diary;
  if (/블로그/.test(n)) return !!d?.blog;
  return !!d?.habits?.[n];
}
function streakOf(fn) {
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const d = state.days[ymd(new Date(Date.now() - i * 864e5))];
    if (d && fn(d)) n++; else if (i > 0) break; // today may be unfinished
  }
  return n;
}

/* ---------- render ---------- */
function render() {
  const now = new Date();
  const cur = currentBand(now);
  const band = selectedBand || cur;
  const name = state.settings.name ? `, ${state.settings.name}` : '';

  document.getElementById('bandLabel').textContent = `${band.label}${selectedBand && selectedBand.id !== cur.id ? ' (미리보기)' : ''}`;
  document.getElementById('greeting').textContent = GREET[band.id] + name;

  const bandsForNav = isWeekend(now) ? [state.settings.bands[0], WEEKEND, ...state.settings.bands.slice(4)] : state.settings.bands;
  document.getElementById('bandNav').innerHTML = bandsForNav.map(b =>
    `<button data-band="${b.id}" class="${b.id === cur.id ? 'now' : ''} ${selectedBand && b.id === selectedBand.id ? 'sel' : ''}">${b.label}${b.start ? ` ${b.start}` : ''}</button>`).join('');

  let first = [...BAND_CARDS[band.id]];
  // 퇴근 30분 전부터는 회사 시간대에 바로타를 올려 준다
  if (band.id === 'work') {
    const end = toMin(today().workStart || state.settings.workStart) + Math.round(state.settings.workHours * 60);
    if (end - nowMin(now) <= 30) first = ['countdown', 'barota', 'todo'];
  }
  const rest = ALL_CARDS.filter(c => !first.includes(c));
  document.getElementById('nowCards').innerHTML = first.map(c => cardHTML(c, true)).join('');
  document.getElementById('otherCards').innerHTML = rest.map(c => cardHTML(c, expanded.has(c))).join('');
  tickClock();
}
function cardHTML(id, open) {
  const wide = ['habits', 'news', 'todo'].includes(id) ? 'wide' : '';
  return `<article class="card ${wide} ${open ? '' : 'collapsed'}" data-card="${id}">${cards[id]()}</article>`;
}
function tickClock() {
  const d = new Date();
  document.getElementById('clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const ko = document.getElementById('koNow'); if (ko) ko.textContent = koTime(d);
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const bandBtn = e.target.closest('[data-band]');
  if (bandBtn) {
    const id = bandBtn.dataset.band;
    const cur = currentBand();
    const b = [...state.settings.bands, WEEKEND].find(x => x.id === id);
    selectedBand = (id === cur.id || (selectedBand && selectedBand.id === id)) ? null : b;
    render(); return;
  }
  const head = e.target.closest('.card.collapsed h3');
  if (head) { expanded.add(head.parentElement.dataset.card); render(); return; }

  const el = e.target.closest('[data-act]');
  if (!el) return;
  const t = today();
  const { act, k, id } = el.dataset;
  switch (act) {
    case 'toggleDay': t[k] = !t[k]; break;
    case 'toggleTori': t.tori[k] = !t.tori[k]; break;
    case 'toggleHabit': t.habits[k] = !t.habits[k]; break;
    case 'toggleTodo': {
      const x = state.todos.find(x => x.id === id);
      if (x) { x.done = !x.done; x.doneDate = x.done ? ymd(new Date()) : null; }
      break;
    }
    case 'delTodo': state.todos = state.todos.filter(x => x.id !== id); break;
    case 'delMemo': state.memos = state.memos.filter(x => x.id !== id); break;
    case 'delWorkout': state.workouts = state.workouts.filter(x => x.id !== id); break;
    case 'arriveNow': { const d = new Date(); t.workStart = `${pad(d.getHours())}:${pad(d.getMinutes())}`; break; }
    case 'resetArrive': delete t.workStart; break;
    case 'reloadWeather': loadWeather(true); return;
    case 'copyTime':
      navigator.clipboard?.writeText(koTime(new Date())).then(() => { el.textContent = '복사됨'; setTimeout(() => (el.textContent = '복사'), 1200); }).catch(() => {});
      return;
    default: return;
  }
  save(); render();
});

document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const fd = new FormData(f);
  const k = ymd(new Date());
  if (f.dataset.form === 'todo') addTodo(fd.get('t'));
  if (f.dataset.form === 'memo') addMemo(fd.get('t'));
  if (f.dataset.form === 'workout') addWorkout(fd.get('type'), fd.get('km'), fd.get('min'));
  save(); render();
  const again = document.querySelector(`[data-form="${f.dataset.form}"] input`);
  again?.focus();
});

document.addEventListener('input', e => {
  if (e.target.dataset.input === 'word') { today().word = e.target.value; save(); }
});

function addTodo(text) { text = (text || '').trim(); if (text) state.todos.push({ id: uid(), text, done: false, date: ymd(new Date()) }); }
function addMemo(text) {
  text = (text || '').trim(); if (!text) return;
  const d = new Date();
  state.memos.unshift({ id: uid(), text, at: `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}` });
}
function addWorkout(type, km, min) {
  km = parseFloat(km) || 0; min = parseInt(min) || 0;
  if (!km && !min) return;
  state.workouts.push({ id: uid(), date: ymd(new Date()), type, km, min });
}
/* "달리기 8.5 56" / "수영 1km 30분" */
function parseWorkout(s) {
  const type = (s.match(/달리기|러닝|수영|걷기|자전거|헬스/) || ['달리기'])[0].replace('러닝', '달리기');
  const nums = (s.match(/\d+(\.\d+)?/g) || []).map(Number);
  return { type, km: nums[0] || 0, min: nums[1] || 0 };
}

/* quick input */
const quick = document.getElementById('quickDialog');
document.getElementById('fab').onclick = () => { document.getElementById('quickText').value = ''; quick.showModal(); };
quick.addEventListener('close', () => {
  if (quick.returnValue !== 'save') return;
  const text = document.getElementById('quickText').value;
  const type = new FormData(document.getElementById('quickForm')).get('qtype');
  if (type === 'todo') addTodo(text);
  if (type === 'memo') addMemo(text);
  if (type === 'workout') { const w = parseWorkout(text); addWorkout(w.type, w.km, w.min); }
  save(); render();
});
document.getElementById('quickText').placeholder = '예: 보고서 초안 / 달리기 8.5 56';

/* settings */
const sd = document.getElementById('settingsDialog');
const sf = document.getElementById('settingsForm');
document.getElementById('openSettings').onclick = () => {
  const s = state.settings;
  document.getElementById('bandInputs').innerHTML = s.bands.map(b =>
    `<label>${b.label}<input type="time" name="band_${b.id}" value="${b.start}"></label>`).join('');
  for (const n of ['name', 'workStart', 'workHours', 'diaryUrl', 'barotaUrl', 'newsKeywords', 'habits']) sf.elements[n].value = s[n];
  sd.showModal();
};
sd.addEventListener('close', () => {
  if (sd.returnValue !== 'save') return;
  const s = state.settings;
  const prevKw = s.newsKeywords;
  for (const n of ['name', 'workStart', 'diaryUrl', 'barotaUrl', 'newsKeywords', 'habits']) s[n] = sf.elements[n].value.trim();
  s.workHours = parseFloat(sf.elements.workHours.value) || 9.5;
  s.bands = s.bands.map(b => ({ ...b, start: sf.elements[`band_${b.id}`].value || b.start }));
  save(); render();
  if (prevKw !== s.newsKeywords) loadNews(true);
});
document.getElementById('exportData').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `naui-haru-${ymd(new Date())}.json` });
  a.click(); URL.revokeObjectURL(a.href);
};
document.getElementById('importData').onclick = () => document.getElementById('importFile').click();
document.getElementById('importFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const s = JSON.parse(await f.text()); state = { ...structuredClone(DEFAULT_STATE), ...s, settings: { ...DEFAULT_STATE.settings, ...s.settings } }; save(); render(); sd.close(); }
  catch { alert('파일을 읽지 못했어요.'); }
};

/* ---------- weather (Open-Meteo, no key) ---------- */
let weatherCache = null;
const WMO = { 0: '맑음', 1: '대체로 맑음', 2: '구름 조금', 3: '흐림', 45: '안개', 48: '안개', 51: '약한 이슬비', 53: '이슬비', 55: '강한 이슬비', 61: '약한 비', 63: '비', 65: '강한 비', 71: '약한 눈', 73: '눈', 75: '강한 눈', 80: '소나기', 81: '소나기', 82: '강한 소나기', 95: '뇌우', 96: '뇌우·우박', 99: '뇌우·우박' };
function pmGrade(pm25, pm10) {
  // 환경부 기준
  const g25 = pm25 == null ? 0 : pm25 <= 15 ? 1 : pm25 <= 35 ? 2 : pm25 <= 75 ? 3 : 4;
  const g10 = pm10 == null ? 0 : pm10 <= 30 ? 1 : pm10 <= 80 ? 2 : pm10 <= 150 ? 3 : 4;
  const g = Math.max(g25, g10);
  return [{ label: '-', cls: '' }, { label: '좋음', cls: 'good' }, { label: '보통', cls: '' }, { label: '나쁨', cls: 'warn' }, { label: '매우 나쁨', cls: 'warn' }][g];
}
async function loadWeather(force) {
  try {
    const c = JSON.parse(sessionStorage.getItem('wx') || 'null');
    if (!force && c && Date.now() - c.t < 20 * 60e3) { weatherCache = c.w; render(); return; }
  } catch {}
  try {
    const q = `latitude=${JAMSIL.lat}&longitude=${JAMSIL.lon}&timezone=Asia%2FSeoul`;
    const [f, a] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,apparent_temperature,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1`).then(r => r.json()),
      fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=pm10,pm2_5`).then(r => r.json()).catch(() => ({})),
    ]);
    const d = new Date();
    weatherCache = {
      temp: f.current.temperature_2m, feels: f.current.apparent_temperature,
      desc: WMO[f.current.weather_code] || '—',
      min: f.daily.temperature_2m_min[0], max: f.daily.temperature_2m_max[0], pop: f.daily.precipitation_probability_max[0],
      pm10: a.current ? Math.round(a.current.pm10) : null, pm25: a.current ? Math.round(a.current.pm2_5) : null,
      at: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
    try { sessionStorage.setItem('wx', JSON.stringify({ t: Date.now(), w: weatherCache })); } catch {}
  } catch { weatherCache = { error: true }; }
  render();
}

/* ---------- news (Vercel function /api/news) ---------- */
let newsCache = null;
async function loadNews(force) {
  const kw = state.settings.newsKeywords;
  try {
    const c = JSON.parse(sessionStorage.getItem('news') || 'null');
    if (!force && c && c.kw === kw && Date.now() - c.t < 30 * 60e3) { newsCache = c.n; render(); return; }
  } catch {}
  try {
    const r = await fetch(`/api/news?q=${encodeURIComponent(kw)}`);
    if (!r.ok) throw 0;
    newsCache = await r.json();
    try { sessionStorage.setItem('news', JSON.stringify({ t: Date.now(), kw, n: newsCache })); } catch {}
  } catch { newsCache = { error: true }; }
  render();
}

/* ---------- boot ---------- */
let lastBand = currentBand().id;
render();
loadWeather();
loadNews();
setInterval(() => {
  const b = currentBand().id;
  const busy = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (busy) { tickClock(); return; }
  if (b !== lastBand) { lastBand = b; selectedBand = null; }
  render();
}, 30e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); loadWeather(); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
