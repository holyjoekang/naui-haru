/**
 * 나의하루 — Google Sheets 저장소 (Apps Script 웹앱)
 *
 * 설치: docs/구글시트-연동.md 참고
 *  1) 새 Google 스프레드시트 → 확장 프로그램 → Apps Script → 이 파일 내용 붙여넣기
 *  2) 함수 목록에서 setup 실행 → 로그에 나온 "비밀 키" 복사
 *  3) 배포 → 새 배포 → 웹 앱 (실행: 나, 액세스: 모든 사용자) → 웹 앱 URL 복사
 *  4) 나의하루 앱 설정에 URL과 비밀 키 입력
 *
 * 시트 구조 (한 행 = 기록 하나, 시트에서 직접 고쳐도 앱에 반영됨)
 *  할일   : id | 날짜 | 내용 | 완료 | 완료일
 *  메모   : id | 시각 | 내용
 *  운동   : id | 날짜 | 종류 | 거리(km) | 시간(분)
 *  하루   : 날짜 | 새벽기도 | 찬양 | 말씀 | 토리_아침 | 토리_저녁 | 감사일기 | 블로그 | 출근도착
 *  습관   : 날짜 | 습관 | 완료
 *  설정   : 키 | 값
 */

const SHEETS = {
  todos:    { name: '할일', head: ['id', '날짜', '내용', '완료', '완료일'] },
  memos:    { name: '메모', head: ['id', '시각', '내용'] },
  workouts: { name: '운동', head: ['id', '날짜', '종류', '거리(km)', '시간(분)'] },
  days:     { name: '하루', head: ['날짜', '새벽기도', '찬양', '말씀', '토리_아침', '토리_저녁', '감사일기', '블로그', '출근도착'] },
  habits:   { name: '습관', head: ['날짜', '습관', '완료'] },
  settings: { name: '설정', head: ['키', '값'] },
};
const PROPS = PropertiesService.getScriptProperties();

/* ---------- 설치 ---------- */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (const k in SHEETS) sheetOf_(ss, SHEETS[k]);
  const first = ss.getSheetByName('Sheet1') || ss.getSheetByName('시트1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  let key = PROPS.getProperty('KEY');
  if (!key) { key = Utilities.getUuid().replace(/-/g, ''); PROPS.setProperty('KEY', key); }
  Logger.log('비밀 키: ' + key);
}

/* 시트에서 직접 고치면 버전을 올려 앱이 다음에 열릴 때 새 내용을 가져가게 함 */
function onEdit() {
  PROPS.setProperty('UPDATED_AT', String(Math.max(Date.now(), version_() + 1)));
}

/* ---------- 웹앱 ---------- */
function doGet(e) {
  if (!authorized_(e.parameter.key)) return json_({ ok: false, error: 'unauthorized' });
  return json_({ ok: true, updatedAt: version_(), state: readState_() });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  if (!authorized_(body.key)) return json_({ ok: false, error: 'unauthorized' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cur = version_();
    // 다른 기기가 먼저 저장했으면 덮어쓰지 않고 최신 상태를 돌려줌 → 앱이 합친 뒤 다시 보냄
    if (!body.force && Number(body.base || 0) < cur) {
      return json_({ ok: false, conflict: true, updatedAt: cur, state: readState_() });
    }
    writeState_(body.state || {});
    const next = Math.max(Date.now(), cur + 1);
    PROPS.setProperty('UPDATED_AT', String(next));
    return json_({ ok: true, updatedAt: next });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 읽기 ---------- */
function readState_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rows = k => {
    const sh = sheetOf_(ss, SHEETS[k]);
    const n = sh.getLastRow() - 1;
    if (n < 1) return [];
    return sh.getRange(2, 1, n, SHEETS[k].head.length).getDisplayValues().filter(r => r.some(c => c !== ''));
  };
  const bool = v => /^(true|1|y|o|✓)$/i.test(String(v).trim());
  const num = v => Number(String(v).replace(/,/g, '')) || 0;

  const todos = rows('todos').map(r => ({ id: r[0] || uid_(), date: r[1], text: r[2], done: bool(r[3]), doneDate: r[4] || null }));
  const memos = rows('memos').map(r => ({ id: r[0] || uid_(), at: r[1], text: r[2] }));
  const workouts = rows('workouts').map(r => ({ id: r[0] || uid_(), date: r[1], type: r[2], km: num(r[3]), min: num(r[4]) }));

  const days = {};
  const day = d => days[d] || (days[d] = { prayer: false, praise: false, word: '', habits: {}, tori: { am: false, pm: false }, diary: false, blog: false });
  for (const r of rows('days')) {
    if (!r[0]) continue;
    const d = day(r[0]);
    d.prayer = bool(r[1]); d.praise = bool(r[2]); d.word = r[3];
    d.tori = { am: bool(r[4]), pm: bool(r[5]) };
    d.diary = bool(r[6]); d.blog = bool(r[7]);
    if (r[8]) d.workStart = r[8];
  }
  for (const r of rows('habits')) if (r[0] && r[1]) day(r[0]).habits[r[1]] = bool(r[2]);

  const settings = {};
  for (const r of rows('settings')) {
    if (!r[0]) continue;
    try { settings[r[0]] = JSON.parse(r[1]); } catch (err) { settings[r[0]] = r[1]; }
  }
  return { settings, days, todos, memos, workouts };
}

/* ---------- 쓰기 (시트 전체를 새 상태로 교체) ---------- */
function writeState_(s) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const b = v => (v ? 'TRUE' : 'FALSE');
  const days = s.days || {};
  const dates = Object.keys(days).sort().reverse();

  put_(ss, 'todos', (s.todos || []).map(x => [x.id, x.date || '', x.text || '', b(x.done), x.doneDate || '']));
  put_(ss, 'memos', (s.memos || []).map(x => [x.id, x.at || '', x.text || '']));
  put_(ss, 'workouts', (s.workouts || []).map(x => [x.id, x.date || '', x.type || '', x.km || 0, x.min || 0]));
  put_(ss, 'days', dates.map(k => {
    const d = days[k] || {}, t = d.tori || {};
    return [k, b(d.prayer), b(d.praise), d.word || '', b(t.am), b(t.pm), b(d.diary), b(d.blog), d.workStart || ''];
  }));
  const habitRows = [];
  for (const k of dates) for (const h in (days[k].habits || {})) habitRows.push([k, h, b(days[k].habits[h])]);
  put_(ss, 'habits', habitRows);
  put_(ss, 'settings', Object.keys(s.settings || {}).map(k => {
    const v = s.settings[k];
    return [k, typeof v === 'string' ? v : JSON.stringify(v)];
  }));
}

function put_(ss, k, rows) {
  const def = SHEETS[k];
  const sh = sheetOf_(ss, def);
  const width = def.head.length;
  const old = sh.getLastRow() - 1;
  if (old > 0) sh.getRange(2, 1, old, width).clearContent();
  if (!rows.length) return;
  const range = sh.getRange(2, 1, rows.length, width);
  range.setNumberFormat('@'); // 날짜·시각을 글자 그대로 보관
  range.setValues(rows.map(r => r.map(c => (c == null ? '' : String(c)))));
}

/* ---------- 도우미 ---------- */
function sheetOf_(ss, def) {
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.head.length).setValues([def.head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@');
  }
  return sh;
}
function authorized_(key) {
  const k = PROPS.getProperty('KEY');
  return !!k && key === k;
}
function version_() { return Number(PROPS.getProperty('UPDATED_AT') || 0); }
function uid_() { return Math.random().toString(36).slice(2, 10); }
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
