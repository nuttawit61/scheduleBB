/**
 * ตารางงานอาจารย์แพทย์ — Google Apps Script Web App
 * ภาควิชาเวชศาสตร์การธนาคารเลือด คณะแพทยศาสตร์ศิริราชพยาบาล
 *
 * ใช้ Google Sheet เป็นที่เก็บข้อมูล 2 ชีต
 *   - entries  : งานของอาจารย์ (1 แถว = 1 งาน)
 *   - holidays : วันหยุด (date, name)
 *
 * วิธีติดตั้งโดยย่อ (ดูรายละเอียดใน README.md)
 *   1) เปิด Google Sheet > ส่วนขยาย > Apps Script แล้ววางโค้ดนี้ทับทั้งหมด
 *   2) แก้รหัสเข้าใช้งานใน CONFIG ด้านล่าง แล้วกดเรียกใช้ฟังก์ชัน setup() หนึ่งครั้ง
 *   3) ทำให้ใช้งานได้ > การทำให้ใช้งานได้รายการใหม่ > เว็บแอป
 *        เรียกใช้ในฐานะ: ฉัน   |   ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน
 *   4) คัดลอก URL เว็บแอป (ลงท้าย /exec) ไปใส่ในไฟล์ config.js
 */

// ===== ตั้งค่า (setup() จะย้ายค่าเหล่านี้ไปเก็บใน Script Properties) =====
const CONFIG = {
  VIEW_KEY: 'เปลี่ยนเป็นรหัสสำหรับดูอย่างเดียว',   // รหัสสำหรับคนที่ดูตารางได้อย่างเดียว
  EDIT_KEY: 'เปลี่ยนเป็นรหัสสำหรับบันทึกงาน',       // รหัสสำหรับคนที่บันทึก/แก้ไข/ลบงานได้
  TIMEZONE: 'Asia/Bangkok',
};

const SHEET_ENTRIES = 'entries';
const SHEET_HOLIDAYS = 'holidays';

// ลำดับคอลัมน์ในชีต entries (แถวที่ 1 เป็นหัวตาราง)
const FIELDS = [
  'id', 'who', 'teacherNames', 'date', 'time', 'start', 'end', 'hours',
  'type', 'title', 'mode', 'venue', 'place', 'platform', 'link', 'meetingId', 'passcode',
  'status', 'level', 'inviter', 'fund', 'edoc', 'notes', 'recName', 'rec',
  'source', 'createdAt', 'updatedAt'
];
// ช่องที่หน้าเว็บส่งมาแก้ไขได้ (id, teacherNames, source, createdAt, updatedAt ระบบจัดการเอง)
const EDITABLE = FIELDS.filter(f => ['id', 'teacherNames', 'source', 'createdAt', 'updatedAt'].indexOf(f) < 0);

const TEACHER_NAMES = {
  AJ: 'ผศ.ดร.พญ.เจนจิรา กิตติวรภัทร',
  AK: 'ผศ.พญ.กุลวรา กิตติสาเรศ',
  APAO: 'นพ.ปวริศร์ อารยะสุขวัฒน์',
  AS: 'รศ.พญ.ศศิจิต เวชแพศย์',
};

// ---------------------------------------------------------------------------
// ติดตั้งครั้งแรก: สร้างชีต หัวตาราง จัดรูปแบบเป็นข้อความ และเก็บรหัสไว้ใน Script Properties
// ---------------------------------------------------------------------------
function setup() {
  const ss = SpreadsheetApp.getActive();
  const ent = ss.getSheetByName(SHEET_ENTRIES) || ss.insertSheet(SHEET_ENTRIES);
  const hol = ss.getSheetByName(SHEET_HOLIDAYS) || ss.insertSheet(SHEET_HOLIDAYS);

  ensureHeader_(ent, FIELDS);
  ensureHeader_(hol, ['date', 'name']);
  [ent, hol].forEach(sh => {
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@'); // เก็บทุกช่องเป็นข้อความ
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#f3e3e6');
  });

  // เติม id ให้แถวที่ยังไม่มี (เช่น แถวที่นำเข้าจาก Excel)
  const values = ent.getDataRange().getDisplayValues();
  const idCol = FIELDS.indexOf('id');
  for (let r = 1; r < values.length; r++) {
    if (values[r].join('') && !values[r][idCol]) ent.getRange(r + 1, idCol + 1).setValue(Utilities.getUuid());
  }

  const props = PropertiesService.getScriptProperties();
  if (CONFIG.VIEW_KEY.indexOf('เปลี่ยนเป็น') !== 0) props.setProperty('VIEW_KEY', CONFIG.VIEW_KEY);
  if (CONFIG.EDIT_KEY.indexOf('เปลี่ยนเป็น') !== 0) props.setProperty('EDIT_KEY', CONFIG.EDIT_KEY);
  if (!props.getProperty('EDIT_KEY')) throw new Error('กรุณาตั้ง EDIT_KEY ใน CONFIG ก่อนเรียก setup()');
  Logger.log('ติดตั้งเรียบร้อย: ' + (values.length - 1) + ' แถวในชีต entries');
}

function ensureHeader_(sh, header) {
  const first = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
  if (first.join('') === '') {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    return;
  }
  // เพิ่มคอลัมน์ที่ยังขาด ต่อท้าย (ไม่ลบคอลัมน์เดิม)
  header.forEach(h => {
    if (first.indexOf(h) < 0) {
      const col = sh.getLastColumn() + 1;
      sh.getRange(1, col).setValue(h);
      first.push(h);
    }
  });
}

// ---------------------------------------------------------------------------
// Web App
// ---------------------------------------------------------------------------
function doGet(e) {
  return handle_(e && e.parameter ? e.parameter : {});
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  return handle_(body);
}

function handle_(p) {
  try {
    const role = role_(p.key);
    if (!role) return out_({ ok: false, error: 'unauthorized' });
    const action = p.action || 'list';

    if (action === 'ping') return out_({ ok: true, role: role });
    if (action === 'list') return out_({ ok: true, role: role, entries: readEntries_(), holidays: readHolidays_(), serverTime: now_() });

    if (role !== 'edit') return out_({ ok: false, error: 'forbidden' });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (action === 'create') return out_({ ok: true, entry: createEntry_(p.data || {}) });
      if (action === 'update') return out_({ ok: true, entry: updateEntry_(String(p.id || ''), p.data || {}) });
      if (action === 'delete') { deleteEntry_(String(p.id || '')); return out_({ ok: true }); }
    } finally {
      lock.releaseLock();
    }
    return out_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return out_({ ok: false, error: 'server_error', message: String(err && err.message || err) });
  }
}

function role_(key) {
  if (!key) return null;
  const props = PropertiesService.getScriptProperties();
  if (key === props.getProperty('EDIT_KEY')) return 'edit';
  if (key === props.getProperty('VIEW_KEY')) return 'view';
  return null;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function now_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

// ---------------------------------------------------------------------------
// อ่าน / เขียนชีต
// ---------------------------------------------------------------------------
function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต "' + name + '" กรุณาเรียก setup() ก่อน');
  return sh;
}

function headerMap_(sh) {
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const map = {};
  head.forEach((h, i) => { if (h) map[String(h).trim()] = i; });
  return { head: head, map: map };
}

function readEntries_() {
  const sh = sheet_(SHEET_ENTRIES);
  const values = sh.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const map = headerMap_(sh).map;
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (!row.join('')) continue;
    const o = {};
    FIELDS.forEach(f => { if (map[f] !== undefined) o[f] = String(row[map[f]] || '').trim(); });
    if (!o.id || !o.date || !o.who) continue;
    o.who = o.who.split(/[,\s]+/).filter(Boolean);
    o.date = normDate_(o.date);
    out.push(o);
  }
  return out;
}

function readHolidays_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_HOLIDAYS);
  if (!sh) return {};
  const values = sh.getDataRange().getDisplayValues();
  const out = {};
  for (let r = 1; r < values.length; r++) {
    const d = normDate_(values[r][0]);
    if (d && values[r][1]) out[d] = String(values[r][1]).trim();
  }
  return out;
}

// รับวันที่ได้ทั้ง 2026-10-01, 1/10/2026 และ 1/10/2569 (พ.ศ.)
function normDate_(v) {
  v = String(v || '').trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad_(m[2]) + '-' + pad_(m[3]);
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) { let y = +m[3]; if (y > 2400) y -= 543; return y + '-' + pad_(m[2]) + '-' + pad_(m[1]); }
  return v;
}
function pad_(n) { return ('0' + n).slice(-2); }

function clean_(data) {
  const o = {};
  EDITABLE.forEach(f => {
    let v = data[f];
    if (f === 'who') v = (Array.isArray(v) ? v : String(v || '').split(/[,\s]+/)).filter(c => TEACHER_NAMES[c]).join(',');
    o[f] = v === undefined || v === null ? '' : String(v).slice(0, 5000);
  });
  if (!o.who) throw new Error('ไม่ได้เลือกอาจารย์');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new Error('วันที่ไม่ถูกต้อง');
  if (!o.title) throw new Error('ไม่ได้ใส่ชื่อรายการ');
  o.teacherNames = o.who.split(',').map(c => TEACHER_NAMES[c]).join(', ');
  return o;
}

function rowFrom_(sh, obj) {
  const hm = headerMap_(sh);
  const row = new Array(hm.head.length).fill('');
  Object.keys(obj).forEach(k => { if (hm.map[k] !== undefined) row[hm.map[k]] = obj[k]; });
  return row;
}

function findRow_(sh, id) {
  const map = headerMap_(sh).map;
  const ids = sh.getRange(2, map.id + 1, Math.max(sh.getLastRow() - 1, 1), 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return -1;
}

function createEntry_(data) {
  const sh = sheet_(SHEET_ENTRIES);
  const o = clean_(data);
  o.id = Utilities.getUuid();
  o.source = 'web';
  o.createdAt = o.updatedAt = now_();
  const row = rowFrom_(sh, o);
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  return o;
}

function updateEntry_(id, data) {
  if (!id) throw new Error('ไม่มี id');
  const sh = sheet_(SHEET_ENTRIES);
  const r = findRow_(sh, id);
  if (r < 0) throw new Error('ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
  const hm = headerMap_(sh);
  const current = sh.getRange(r, 1, 1, hm.head.length).getDisplayValues()[0];
  const o = clean_(data);
  o.id = id;
  o.source = current[hm.map.source] || 'web';
  o.createdAt = current[hm.map.createdAt] || now_();
  o.updatedAt = now_();
  const row = rowFrom_(sh, o);
  // คงค่าคอลัมน์อื่นที่ผู้ใช้เพิ่มเองในชีต
  hm.head.forEach((h, i) => { if (FIELDS.indexOf(h) < 0) row[i] = current[i]; });
  sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  return o;
}

function deleteEntry_(id) {
  if (!id) throw new Error('ไม่มี id');
  const sh = sheet_(SHEET_ENTRIES);
  const r = findRow_(sh, id);
  if (r > 0) sh.deleteRow(r);
}

// ทดสอบใน editor: ดูว่าอ่านข้อมูลได้กี่แถว
function testList() {
  Logger.log(readEntries_().length + ' รายการ, ' + Object.keys(readHolidays_()).length + ' วันหยุด');
}
