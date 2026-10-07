/**
 * ตารางงานอาจารย์แพทย์ — Google Apps Script Web App
 * ภาควิชาเวชศาสตร์การธนาคารเลือด คณะแพทยศาสตร์ศิริราชพยาบาล
 *
 * ใช้ Google Sheet เป็นที่เก็บข้อมูล 3 ชีต
 *   - entries  : งานของอาจารย์ (1 แถว = 1 งาน)
 *   - holidays : วันหยุด (date, name)
 *   - users    : บัญชีผู้ใช้ (รหัสผ่านเก็บแบบเข้ารหัสทางเดียว ไม่มีใครอ่านรหัสจริงได้)
 *   - logs     : ประวัติการใช้งาน ใครเพิ่ม/แก้/ลบงานอะไร เมื่อไร และการจัดการบัญชี (ระบบสร้างชีตให้เอง)
 *
 * ผู้ใช้สมัครและตั้งรหัสผ่านเองที่หน้า register.html แล้วรอผู้ดูแลระบบอนุมัติในหน้า account.html
 * ลืมรหัสผ่าน: ผู้ใช้ตั้งรหัสใหม่เองที่หน้าเดียวกัน แล้วรอผู้ดูแลอนุมัติ (รหัสเดิมใช้ได้จนกว่าจะอนุมัติ)
 *
 * วิธีติดตั้ง / อัปเดต
 *   1) เปิด Google Sheet > ส่วนขยาย > Apps Script แล้ววางโค้ดนี้ทับทั้งหมด > บันทึก
 *   2) เลือกฟังก์ชัน setup แล้วกด "เรียกใช้" หนึ่งครั้ง (กดอนุญาตสิทธิ์)
 *      ครั้งแรกระบบจะสร้างบัญชีผู้ดูแล "admin" และแสดงรหัสชั่วคราวในบันทึกการดำเนินการ (Execution log)
 *   3) ทำให้ใช้งานได้ > จัดการการทำให้ใช้งานได้ > ✎ > เวอร์ชันใหม่ > ทำให้ใช้งานได้
 *      (ติดตั้งครั้งแรก: การทำให้ใช้งานได้รายการใหม่ > เว็บแอป · เรียกใช้ในฐานะ: ฉัน · ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน)
 *   4) คัดลอก URL เว็บแอป (ลงท้าย /exec) ไปใส่ในไฟล์ config.js
 *
 * ไม่ได้รหัส admin / ลืมรหัส admin:
 *   - ในหน้า Google Sheet กดเมนู "ระบบตารางงาน > ออกรหัสชั่วคราวให้ admin" (รีเฟรชหน้าชีตหนึ่งครั้งถ้ายังไม่เห็นเมนู)
 *   - หรือใน Apps Script เลือกฟังก์ชัน resetAdmin แล้วกด "เรียกใช้" แล้วดูรหัสในบันทึกการดำเนินการ (Execution log)
 */

// ===== ตั้งค่า =====
const CONFIG = {
  TIMEZONE: 'Asia/Bangkok',
  SESSION_HOURS: 6,      // เข้าสู่ระบบค้างไว้ได้นานสุดกี่ชั่วโมง (สูงสุด 6) หน้าเว็บจะออกเองเมื่อไม่มีการใช้งานตาม config.js อยู่แล้ว
  MIN_PASSWORD: 8,       // ความยาวรหัสผ่านขั้นต่ำ
  MAX_FAILS: 5,          // ใส่รหัสผิดติดกันกี่ครั้งจึงล็อกบัญชีชั่วคราว
  LOCK_MINUTES: 15,      // ล็อกกี่นาที
  FIRST_ADMIN: 'admin',  // ชื่อผู้ใช้ของผู้ดูแลระบบคนแรก
  MAX_PENDING: 30,       // รับคำขอสมัครที่รออนุมัติได้สูงสุดกี่รายการ (กันการสมัครรัว ๆ)
  LOG_LOGINS: true,      // บันทึกการเข้าสู่ระบบลงประวัติด้วย
  LOG_VIEWERS: ['admin'],// สิทธิ์ที่เปิดดูหน้าประวัติการใช้งานได้ (เพิ่ม 'edit' ถ้าอยากให้ผู้บันทึกงานดูได้ด้วย)
};

const SHEET_ENTRIES = 'entries';
const SHEET_HOLIDAYS = 'holidays';
const SHEET_USERS = 'users';
const SHEET_LOGS = 'logs';
const LOG_FIELDS = ['time', 'username', 'name', 'action', 'target', 'entryId', 'entryDate', 'summary', 'changes'];

// ลำดับคอลัมน์ในชีต entries (แถวที่ 1 เป็นหัวตาราง)
const FIELDS = [
  'id', 'who', 'teacherNames', 'date', 'time', 'start', 'end', 'hours',
  'type', 'title', 'mode', 'venue', 'place', 'platform', 'link', 'meetingId', 'passcode',
  'status', 'level', 'inviter', 'fund', 'docChannel', 'edoc', 'notes', 'recName', 'rec',
  'source', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'
];
// ช่องที่หน้าเว็บส่งมาแก้ไขได้ (ช่องที่เหลือระบบจัดการเอง)
const SYSTEM_FIELDS = ['id', 'teacherNames', 'source', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'];
const EDITABLE = FIELDS.filter(f => SYSTEM_FIELDS.indexOf(f) < 0);

// ชีต users: username, ชื่อ, สิทธิ์ (admin = ผู้ดูแล, edit = บันทึก/แก้ไขงาน, view = ดูอย่างเดียว)
const USER_FIELDS = ['username', 'name', 'role', 'active', 'approved', 'mustChange', 'salt', 'hash', 'pwChangedAt',
  'note', 'resetSalt', 'resetHash', 'resetAt', 'createdAt', 'updatedAt', 'lastLogin', 'approvedBy'];
const ROLES = ['admin', 'edit', 'view'];

const TEACHER_NAMES = {
  AJ: 'ผศ.ดร.พญ.เจนจิรา กิตติวรภัทร',
  AK: 'ผศ.พญ.กุลวรา กิตติสาเรศ',
  APAO: 'นพ.ปวริศร์ อารยะสุขวัฒน์',
  AS: 'รศ.พญ.ศศิจิต เวชแพศย์',
};

// ---------------------------------------------------------------------------
// ติดตั้งครั้งแรก / อัปเดต: สร้างชีต หัวตาราง และบัญชีผู้ดูแลคนแรก
// ---------------------------------------------------------------------------
function setup() {
  const ss = SpreadsheetApp.getActive();
  const ent = ss.getSheetByName(SHEET_ENTRIES) || ss.insertSheet(SHEET_ENTRIES);
  const hol = ss.getSheetByName(SHEET_HOLIDAYS) || ss.insertSheet(SHEET_HOLIDAYS);
  const usr = ss.getSheetByName(SHEET_USERS) || ss.insertSheet(SHEET_USERS);

  ensureHeader_(ent, FIELDS);
  ensureHeader_(hol, ['date', 'name']);
  ensureHeader_(usr, USER_FIELDS);
  [ent, hol, usr].forEach(sh => {
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@'); // เก็บทุกช่องเป็นข้อความ
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#f3e3e6');
  });

  // เติม id ให้แถวที่ยังไม่มี (เช่น แถวที่นำเข้าจาก Excel)
  const values = ent.getDataRange().getDisplayValues();
  const idCol = headerMap_(ent).map.id;
  for (let r = 1; r < values.length; r++) {
    if (values[r].join('') && !values[r][idCol]) ent.getRange(r + 1, idCol + 1).setValue(Utilities.getUuid());
  }

  pepper_(); // สร้างค่าลับสำหรับเข้ารหัสรหัสผ่าน (ครั้งแรกเท่านั้น)
  logSheet_(); // ชีตประวัติการใช้งาน

  // ลบรหัสกลางแบบเดิม (ถ้ามี) เพราะเปลี่ยนมาใช้บัญชีรายคนแล้ว
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('VIEW_KEY'); props.deleteProperty('EDIT_KEY');

  // ยังไม่มีผู้ดูแลที่ตั้งรหัสผ่านเองเรียบร้อย → ออกรหัสชั่วคราวให้บัญชี admin (ออกใหม่ทุกครั้งที่เรียก setup จนกว่าจะตั้งรหัสเอง)
  const ready = readUsers_().filter(u => u.role === 'admin' && u.active && u.approved && !u.mustChange);
  let temp = '';
  if (!ready.length) {
    temp = resetUserPassword_(CONFIG.FIRST_ADMIN, { name: 'ผู้ดูแลระบบ', role: 'admin', create: true, activate: true });
    Logger.log('ชื่อผู้ใช้ผู้ดูแลระบบ: ' + CONFIG.FIRST_ADMIN + '   รหัสชั่วคราว: ' + temp);
    Logger.log('เข้าสู่ระบบที่หน้าเว็บด้วยรหัสนี้ ระบบจะให้ตั้งรหัสผ่านใหม่ทันที');
  } else {
    Logger.log('มีผู้ดูแลระบบที่ตั้งรหัสผ่านแล้ว: ' + ready.map(u => u.username).join(', ') + ' (ถ้าลืมรหัส admin ให้เรียกฟังก์ชัน resetAdmin)');
  }
  Logger.log('ติดตั้งเรียบร้อย: ' + (values.length - 1) + ' แถวในชีต entries, ' + readUsers_().length + ' บัญชีผู้ใช้');
  return temp;
}

// ลืมรหัสผู้ดูแล: เรียกฟังก์ชันนี้ใน editor เพื่อออกรหัสชั่วคราวใหม่ให้บัญชี admin
function resetAdmin() {
  const temp = resetUserPassword_(CONFIG.FIRST_ADMIN, { name: 'ผู้ดูแลระบบ', role: 'admin', create: true, activate: true });
  Logger.log('ชื่อผู้ใช้: ' + CONFIG.FIRST_ADMIN + '   รหัสชั่วคราวใหม่: ' + temp);
  return temp;
}

// ---------------------------------------------------------------------------
// เมนู "ระบบตารางงาน" ในหน้า Google Sheet (ไม่ต้องเปิด Apps Script)
// ---------------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('ระบบตารางงาน')
    .addItem('ออกรหัสชั่วคราวให้ admin', 'menuResetAdmin')
    .addItem('ติดตั้ง / อัปเดตชีต (setup)', 'menuSetup')
    .addToUi();
}

function menuResetAdmin() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('ออกรหัสชั่วคราวให้ admin', 'รหัสผ่านเดิมของบัญชี "' + CONFIG.FIRST_ADMIN + '" จะใช้ไม่ได้อีก ต้องการทำต่อไหม', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  showTemp_(resetAdmin());
}

function menuSetup() {
  const temp = setup();
  if (temp) showTemp_(temp);
  else SpreadsheetApp.getUi().alert('ติดตั้ง / อัปเดตเรียบร้อย', 'มีผู้ดูแลระบบที่ตั้งรหัสผ่านแล้ว ถ้าลืมรหัส admin ให้ใช้เมนู "ออกรหัสชั่วคราวให้ admin"', SpreadsheetApp.getUi().ButtonSet.OK);
}

function showTemp_(temp) {
  SpreadsheetApp.getUi().alert('รหัสชั่วคราวของผู้ดูแลระบบ',
    'ชื่อผู้ใช้:  ' + CONFIG.FIRST_ADMIN + '\nรหัสชั่วคราว:  ' + temp +
    '\n\nเข้าสู่ระบบที่หน้าเว็บด้วยรหัสนี้ ระบบจะให้ตั้งรหัสผ่านใหม่ทันที\n(จดไว้ก่อนกด OK รหัสนี้จะไม่แสดงอีก)',
    SpreadsheetApp.getUi().ButtonSet.OK);
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
      if (col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
      sh.getRange(1, col).setNumberFormat('@').setValue(h);
      sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@');
      first.push(h);
    }
  });
}

// ---------------------------------------------------------------------------
// Web App
// ---------------------------------------------------------------------------
function doGet(e) {
  return out_({ ok: true, app: 'teacher-schedule', note: 'ใช้งานผ่านหน้าเว็บเท่านั้น' });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  return handle_(body);
}

function handle_(p) {
  try {
    const action = String(p.action || 'list');

    if (action === 'login') return out_(login_(p.username, p.password));
    if (action === 'register') return withLock_(() => out_(register_(p)));
    if (action === 'request_reset') return withLock_(() => out_(requestReset_(p)));

    const s = session_(p.key);
    if (!s) return out_({ ok: false, error: 'unauthorized' });
    const me = s.user;

    if (action === 'logout') { endSession_(p.key); return out_({ ok: true }); }
    if (action === 'ping' || action === 'me') return out_({ ok: true, role: dataRole_(me), user: publicUser_(me), pending: pendingCount_(me), canViewLogs: CONFIG.LOG_VIEWERS.indexOf(me.role) >= 0 });
    if (action === 'changePassword') return out_(changePassword_(me, p.oldPassword, p.newPassword, p.key));
    if (action === 'updateProfile') return withLock_(() => out_(updateProfile_(me, p)));

    // บัญชีที่ใช้รหัสชั่วคราวต้องตั้งรหัสใหม่ก่อน
    if (me.mustChange) return out_({ ok: false, error: 'must_change' });

    if (action === 'list') return out_({ ok: true, role: dataRole_(me), user: publicUser_(me), pending: pendingCount_(me), canViewLogs: CONFIG.LOG_VIEWERS.indexOf(me.role) >= 0, entries: readEntries_(), holidays: readHolidays_(), serverTime: now_() });

    if (action === 'logs_list') {
      if (CONFIG.LOG_VIEWERS.indexOf(me.role) < 0) return out_({ ok: false, error: 'forbidden' });
      return out_({ ok: true, logs: readLogs_(+p.limit || 1500) });
    }

    if (action.indexOf('users_') === 0) {
      if (me.role !== 'admin') return out_({ ok: false, error: 'forbidden' });
      return withLock_(() => out_(adminAction_(me, action, p)));
    }

    if (dataRole_(me) !== 'edit') return out_({ ok: false, error: 'forbidden' });
    return withLock_(() => {
      if (action === 'create') return out_({ ok: true, entry: createEntry_(p.data || {}, me) });
      if (action === 'update') return out_({ ok: true, entry: updateEntry_(String(p.id || ''), p.data || {}, me) });
      if (action === 'delete') { deleteEntry_(String(p.id || ''), me); return out_({ ok: true }); }
      return out_({ ok: false, error: 'unknown_action' });
    });
  } catch (err) {
    if (err && err.code) return out_({ ok: false, error: err.code, message: err.message || '' });
    return out_({ ok: false, error: 'server_error', message: String(err && err.message || err) });
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function fail_(code, message) { const e = new Error(message || code); e.code = code; return e; }

// ---------------------------------------------------------------------------
// บัญชีผู้ใช้และการเข้าสู่ระบบ
// ---------------------------------------------------------------------------
function dataRole_(u) { return u.role === 'view' ? 'view' : 'edit'; }
function publicUser_(u) {
  return { username: u.username, name: u.name, role: u.role, active: u.active, approved: u.approved, mustChange: u.mustChange,
    note: u.note, resetRequested: !!u.resetHash, resetAt: u.resetAt, lastLogin: u.lastLogin, createdAt: u.createdAt, approvedBy: u.approvedBy };
}
// จำนวนคำขอที่รอผู้ดูแลจัดการ (แสดงเป็นตัวเลขแจ้งเตือนให้ผู้ดูแล)
function pendingCount_(me) {
  if (!me || me.role !== 'admin') return 0;
  return readUsers_().filter(u => !u.approved || (u.resetHash && u.active)).length;
}
function normUser_(v) { return String(v || '').trim().toLowerCase(); }

function readUsers_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_USERS);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getDisplayValues();
  const map = headerMap_(sh).map;
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const o = { _row: r + 1 };
    USER_FIELDS.forEach(f => { o[f] = map[f] !== undefined ? String(row[map[f]] || '').trim() : ''; });
    o.username = normUser_(o.username);
    if (!o.username) continue;
    o.role = ROLES.indexOf(o.role) >= 0 ? o.role : 'view';
    o.active = !/^(false|0|no|ปิด)$/i.test(o.active);
    o.approved = !/^(false|0|no|รอ)$/i.test(o.approved); // ช่องว่าง = อนุมัติแล้ว (บัญชีที่สร้างก่อนมีระบบสมัคร)
    o.mustChange = /^(true|1|yes)$/i.test(o.mustChange);
    out.push(o);
  }
  return out;
}

function findUser_(username) {
  username = normUser_(username);
  return readUsers_().filter(u => u.username === username)[0] || null;
}

function writeUser_(u) {
  const sh = sheet_(SHEET_USERS);
  ensureHeader_(sh, USER_FIELDS);
  const obj = {};
  USER_FIELDS.forEach(f => { obj[f] = u[f] === undefined || u[f] === null ? '' : String(u[f]); });
  obj.active = u.active ? 'TRUE' : 'FALSE';
  obj.approved = u.approved === false ? 'FALSE' : 'TRUE';
  obj.mustChange = u.mustChange ? 'TRUE' : 'FALSE';
  const hm = headerMap_(sh);
  if (u._row) {
    const current = sh.getRange(u._row, 1, 1, hm.head.length).getDisplayValues()[0];
    const row = rowFrom_(sh, obj);
    hm.head.forEach((h, i) => { if (USER_FIELDS.indexOf(h) < 0) row[i] = current[i]; });
    sh.getRange(u._row, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  } else {
    const row = rowFrom_(sh, obj);
    const r = sh.getLastRow() + 1;
    sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    u._row = r;
  }
  return u;
}

function pepper_() {
  const props = PropertiesService.getScriptProperties();
  let p = props.getProperty('PW_PEPPER');
  if (!p) { p = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('PW_PEPPER', p); }
  return p;
}

function hashPassword_(salt, password) {
  const pepper = pepper_();
  let h = Utilities.computeHmacSha256Signature(salt + ':' + password, pepper, Utilities.Charset.UTF_8);
  for (let i = 0; i < 300; i++) h = Utilities.computeHmacSha256Signature(h.concat(Utilities.newBlob(salt).getBytes()), Utilities.newBlob(pepper).getBytes());
  return Utilities.base64Encode(h);
}

function checkPassword_(u, password) {
  if (!u.salt || !u.hash) return false;
  const a = hashPassword_(u.salt, String(password || '')), b = u.hash;
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function setPassword_(u, password) {
  u.salt = Utilities.getUuid().replace(/-/g, '');
  u.hash = hashPassword_(u.salt, password);
  u.pwChangedAt = String(Date.now());
}

function validatePassword_(pw, u) {
  pw = String(pw || '');
  if (pw.length < CONFIG.MIN_PASSWORD) throw fail_('weak_password', 'รหัสผ่านต้องยาวอย่างน้อย ' + CONFIG.MIN_PASSWORD + ' ตัวอักษร');
  if (!/[A-Za-z฀-๿]/.test(pw) || !/[0-9]/.test(pw)) throw fail_('weak_password', 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข');
  if (u && normUser_(pw) === u.username) throw fail_('weak_password', 'รหัสผ่านต้องไม่เหมือนชื่อผู้ใช้');
  if (pw.length > 200) throw fail_('weak_password', 'รหัสผ่านยาวเกินไป');
}

function tempPassword_() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  for (let i = 0; i < 4; i++) s += digits.charAt(Math.floor(Math.random() * digits.length));
  return s;
}

function resetUserPassword_(username, opt) {
  opt = opt || {};
  username = normUser_(username);
  let u = findUser_(username);
  if (!u) {
    if (!opt.create) throw fail_('not_found', 'ไม่พบผู้ใช้นี้');
    u = { username: username, name: opt.name || username, role: opt.role || 'view', active: true, createdAt: now_() };
  }
  if (opt.activate) { u.active = true; u.approved = true; if (opt.role) u.role = opt.role; }
  u.resetSalt = u.resetHash = u.resetAt = '';
  const temp = tempPassword_();
  setPassword_(u, temp);
  u.mustChange = true;
  u.updatedAt = now_();
  writeUser_(u);
  CacheService.getScriptCache().remove('fail_' + username);
  return temp;
}

function login_(username, password) {
  username = normUser_(username);
  if (!username || !password) return { ok: false, error: 'invalid_login' };
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + username;
  const fails = +(cache.get(failKey) || 0);
  if (fails >= CONFIG.MAX_FAILS) return { ok: false, error: 'locked', message: 'ใส่รหัสผิดหลายครั้ง ลองใหม่ใน ' + CONFIG.LOCK_MINUTES + ' นาที' };
  const u = findUser_(username);
  if (!u || !u.active || !u.approved || !checkPassword_(u, password)) {
    cache.put(failKey, String(fails + 1), CONFIG.LOCK_MINUTES * 60);
    const left = CONFIG.MAX_FAILS - fails - 1;
    if (u && !u.approved && u.hash && checkPassword_(u, password)) { cache.remove(failKey); return { ok: false, error: 'pending' }; }
    if (u && !u.active && u.hash && checkPassword_(u, password)) return { ok: false, error: 'disabled' };
    return { ok: false, error: left <= 0 ? 'locked' : 'invalid_login', message: left <= 0 ? 'ใส่รหัสผิดหลายครั้ง ลองใหม่ใน ' + CONFIG.LOCK_MINUTES + ' นาที' : (left <= 2 ? 'ใส่ผิดได้อีก ' + left + ' ครั้ง' : '') };
  }
  cache.remove(failKey);
  u.lastLogin = now_();
  writeUser_(u);
  if (CONFIG.LOG_LOGINS) log_(u, 'login', { summary: 'เข้าสู่ระบบ' });
  return { ok: true, token: startSession_(u), role: dataRole_(u), user: publicUser_(u) };
}

function sessionTtl_() { return Math.min(21600, Math.max(600, CONFIG.SESSION_HOURS * 3600)); }

function startSession_(u) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify({ u: u.username, pw: u.pwChangedAt }), sessionTtl_());
  return token;
}

function endSession_(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + String(token));
}

// ตรวจ token ทุกครั้ง และอ่านบัญชีล่าสุดจากชีต (ถ้าถูกปิดใช้งาน เปลี่ยนสิทธิ์ หรือเปลี่ยนรหัส จะมีผลทันที)
function session_(token) {
  token = String(token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const cache = CacheService.getScriptCache();
  const raw = cache.get('sess_' + token);
  if (!raw) return null;
  let s; try { s = JSON.parse(raw); } catch (e) { return null; }
  const u = findUser_(s.u);
  if (!u || !u.active || !u.approved || String(u.pwChangedAt) !== String(s.pw)) { cache.remove('sess_' + token); return null; }
  cache.put('sess_' + token, raw, sessionTtl_()); // ต่ออายุเมื่อมีการใช้งาน
  return { user: u };
}

function validUsername_(username) {
  if (!/^[a-z0-9._@-]{3,60}$/.test(username)) throw fail_('invalid_argument', 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - @ ยาว 3–60 ตัว');
}

// ผู้ใช้สมัครเองและตั้งรหัสผ่านเอง บัญชีจะใช้ได้เมื่อผู้ดูแลอนุมัติ
function register_(p) {
  const username = normUser_(p.username);
  validUsername_(username);
  const name = String(p.name || '').trim().slice(0, 120);
  if (!name) throw fail_('invalid_argument', 'กรุณาใส่ชื่อ-นามสกุล');
  const users = readUsers_();
  if (users.some(u => u.username === username)) throw fail_('exists', 'มีชื่อผู้ใช้นี้แล้ว เลือกชื่ออื่น หรือถ้าเป็นบัญชีของคุณให้ใช้ "ลืมรหัสผ่าน"');
  if (users.filter(u => !u.approved).length >= CONFIG.MAX_PENDING) throw fail_('too_many', 'มีคำขอรออนุมัติจำนวนมาก กรุณาติดต่อผู้ดูแลระบบ');
  const u = { username: username, name: name, role: 'view', active: true, approved: false, mustChange: false,
    note: String(p.note || '').trim().slice(0, 200), createdAt: now_(), updatedAt: now_() };
  validatePassword_(p.password, u);
  setPassword_(u, String(p.password));
  writeUser_(u);
  log_(u, 'register', { target: who_(u), summary: 'สมัครใช้งาน รอผู้ดูแลอนุมัติ' + (u.note ? ' (' + u.note + ')' : '') });
  return { ok: true };
}

// ลืมรหัสผ่าน: ผู้ใช้ตั้งรหัสใหม่เอง เก็บไว้รอผู้ดูแลอนุมัติ (รหัสเดิมยังใช้ได้จนกว่าจะอนุมัติ)
function requestReset_(p) {
  const username = normUser_(p.username);
  if (!username) throw fail_('invalid_argument', 'กรุณาใส่ชื่อผู้ใช้');
  validatePassword_(p.password, { username: username });
  const cache = CacheService.getScriptCache();
  if (cache.get('rr_' + username)) throw fail_('too_soon', 'เพิ่งส่งคำขอไป กรุณารอสักครู่แล้วลองใหม่');
  cache.put('rr_' + username, '1', 120);
  const u = findUser_(username);
  // ตอบเหมือนกันทุกกรณี เพื่อไม่ให้ใช้หน้านี้ตรวจว่ามีชื่อผู้ใช้ใดอยู่ในระบบ
  if (u && u.approved) {
    u.resetSalt = Utilities.getUuid().replace(/-/g, '');
    u.resetHash = hashPassword_(u.resetSalt, String(p.password));
    u.resetAt = now_();
    writeUser_(u);
    log_(u, 'reset_request', { target: who_(u), summary: 'ขอตั้งรหัสผ่านใหม่ (ลืมรหัสผ่าน) รอผู้ดูแลอนุมัติ' });
  }
  return { ok: true };
}

function changePassword_(me, oldPw, newPw, token) {
  if (!checkPassword_(me, oldPw)) return { ok: false, error: 'wrong_password' };
  validatePassword_(newPw, me);
  if (oldPw === newPw) throw fail_('weak_password', 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
  return withLock_(() => {
    const u = findUser_(me.username);
    setPassword_(u, String(newPw));
    u.mustChange = false;
    u.resetSalt = u.resetHash = u.resetAt = '';
    u.updatedAt = now_();
    writeUser_(u);
    log_(u, 'password_change', { target: who_(u), summary: me.mustChange ? 'ตั้งรหัสผ่านใหม่แทนรหัสชั่วคราว' : 'เปลี่ยนรหัสผ่าน' });
    endSession_(token);
    return { ok: true, token: startSession_(u), role: dataRole_(u), user: publicUser_(u) };
  });
}

// ผู้ใช้แก้ชื่อ-นามสกุลของตัวเอง
function updateProfile_(me, p) {
  const name = String(p.name || '').trim().slice(0, 120);
  if (!name) throw fail_('invalid_argument', 'กรุณาใส่ชื่อ-นามสกุล');
  const u = findUser_(me.username);
  if (name !== u.name) {
    const from = u.name;
    u.name = name; u.updatedAt = now_();
    writeUser_(u);
    log_(u, 'profile_name', { target: who_(u), summary: 'แก้ชื่อของตัวเอง: ' + from + ' → ' + name, changes: [{ f: 'name', label: 'ชื่อ-นามสกุล', from: from, to: name }] });
  }
  return { ok: true, user: publicUser_(u) };
}

// ---------------------------------------------------------------------------
// ประวัติการใช้งาน (ชีต logs)
// ---------------------------------------------------------------------------
const ROLE_TH = { admin: 'ผู้ดูแลระบบ', edit: 'บันทึกและแก้ไขงาน', view: 'ดูอย่างเดียว' };
const FIELD_TH = {
  who: 'อาจารย์', date: 'วันที่', time: 'เวลา', start: 'เวลาเริ่ม', end: 'เวลาสิ้นสุด', hours: 'ชั่วโมง', type: 'ประเภท', title: 'รายการ',
  mode: 'รูปแบบ', venue: 'สถานที่', platform: 'แพลตฟอร์ม', link: 'ลิงก์เข้าร่วม', meetingId: 'Meeting ID', passcode: 'Passcode',
  status: 'สถานะ', level: 'ระดับการประชุม', inviter: 'หน่วยงานที่เชิญ', fund: 'ทุนสนับสนุน', docChannel: 'ช่องทางเอกสาร', edoc: 'URL EDOC',
  notes: 'รายละเอียดเพิ่มเติม', recName: 'ผู้บันทึก'
};
const MODE_TH_ = { onsite: 'ในสถานที่', online: 'ออนไลน์', hybrid: 'ไฮบริด' };

function who_(u) { return (u.name || u.username) + ' (' + u.username + ')'; }

function showVal_(f, v) {
  v = String(v == null ? '' : v);
  if (f === 'who') return v.split(/[,\s]+/).filter(Boolean).map(c => TEACHER_NAMES[c] || c).join(', ');
  if (f === 'mode') return MODE_TH_[v] || v;
  return v;
}

function entryChanges_(before, after) {
  const out = [];
  Object.keys(FIELD_TH).forEach(f => {
    const a = String(before[f] == null ? '' : before[f]).trim(), b = String(after[f] == null ? '' : after[f]).trim();
    const same = f === 'who' ? a.split(/[,\s]+/).filter(Boolean).sort().join(',') === b.split(/[,\s]+/).filter(Boolean).sort().join(',') : a === b;
    if (!same) out.push({ f: f, label: FIELD_TH[f], from: showVal_(f, a).slice(0, 500), to: showVal_(f, b).slice(0, 500) });
  });
  return out;
}

function logSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_LOGS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_LOGS);
    sh.getRange(1, 1, 1, LOG_FIELDS.length).setValues([LOG_FIELDS]).setFontWeight('bold').setBackground('#f3e3e6');
    sh.setFrozenRows(1);
  }
  return sh;
}

// เขียนประวัติ 1 แถว (ถ้าเขียนไม่สำเร็จ งานหลักยังทำต่อได้)
function log_(actor, action, info) {
  try {
    info = info || {};
    const sh = logSheet_();
    const row = [now_(), actor ? actor.username : '', actor ? actor.name : '', action, info.target || '', info.entryId || '', info.entryDate || '',
      String(info.summary || '').slice(0, 1000), info.changes && info.changes.length ? JSON.stringify(info.changes).slice(0, 45000) : ''];
    const r = sh.getLastRow() + 1;
    sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  } catch (e) {
    console.error('log_ failed: ' + e);
  }
}

function readLogs_(limit) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_LOGS);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  limit = Math.max(1, Math.min(limit || 1500, 5000));
  const start = Math.max(2, last - limit + 1);
  const width = Math.max(sh.getLastColumn(), LOG_FIELDS.length);
  const head = sh.getRange(1, 1, 1, width).getDisplayValues()[0];
  const idx = {}; head.forEach((h, i) => { if (h) idx[String(h).trim()] = i; });
  const values = sh.getRange(start, 1, last - start + 1, width).getDisplayValues();
  const out = [];
  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    if (!row.join('')) continue;
    const o = {};
    LOG_FIELDS.forEach(f => { o[f] = idx[f] !== undefined ? row[idx[f]] : ''; });
    try { o.changes = o.changes ? JSON.parse(o.changes) : []; } catch (e) { o.changes = []; }
    out.push(o);
  }
  return out;
}

function adminAction_(me, action, p) {
  if (action === 'users_list') return { ok: true, users: readUsers_().map(publicUser_) };

  const u = findUser_(p.username);
  if (!u) throw fail_('not_found', 'ไม่พบผู้ใช้นี้');
  const stamp = me.name + ' (' + me.username + ')';
  const activeAdmins = () => readUsers_().filter(x => x.role === 'admin' && x.active && x.approved).length;

  if (action === 'users_approve') {
    if (u.approved) return { ok: true, user: publicUser_(u) };
    u.approved = true; u.active = true;
    u.role = ROLES.indexOf(p.role) >= 0 ? p.role : 'view';
    u.approvedBy = stamp; u.updatedAt = now_();
    writeUser_(u);
    log_(me, 'user_approve', { target: who_(u), summary: 'อนุมัติบัญชี ' + who_(u) + ' สิทธิ์: ' + ROLE_TH[u.role] });
    return { ok: true, user: publicUser_(u) };
  }

  if (action === 'users_reject') {
    if (u.approved) throw fail_('invalid_argument', 'บัญชีนี้อนุมัติแล้ว ใช้ปุ่มลบแทน');
    sheet_(SHEET_USERS).deleteRow(u._row);
    log_(me, 'user_reject', { target: who_(u), summary: 'ปฏิเสธคำขอสมัครของ ' + who_(u) });
    return { ok: true };
  }

  if (action === 'users_reset_approve') {
    if (!u.resetHash) throw fail_('invalid_argument', 'ไม่มีคำขอเปลี่ยนรหัสผ่านของผู้ใช้นี้');
    u.salt = u.resetSalt; u.hash = u.resetHash; u.pwChangedAt = String(Date.now());
    u.resetSalt = u.resetHash = u.resetAt = '';
    u.mustChange = false; u.updatedAt = now_();
    writeUser_(u);
    CacheService.getScriptCache().remove('fail_' + u.username);
    log_(me, 'reset_approve', { target: who_(u), summary: 'อนุมัติรหัสผ่านใหม่ของ ' + who_(u) });
    return { ok: true, user: publicUser_(u) };
  }

  if (action === 'users_reset_reject') {
    u.resetSalt = u.resetHash = u.resetAt = ''; u.updatedAt = now_();
    writeUser_(u);
    log_(me, 'reset_reject', { target: who_(u), summary: 'ไม่อนุมัติคำขอรหัสผ่านใหม่ของ ' + who_(u) });
    return { ok: true, user: publicUser_(u) };
  }

  if (action === 'users_update') {
    const next = {
      name: p.name !== undefined ? String(p.name).trim().slice(0, 120) : u.name,
      role: p.role !== undefined && ROLES.indexOf(p.role) >= 0 ? p.role : u.role,
      active: p.active !== undefined ? !!p.active : u.active,
    };
    if (!next.name) throw fail_('invalid_argument', 'กรุณาใส่ชื่อ-นามสกุล');
    if (u.username === me.username && (next.role !== 'admin' || !next.active)) throw fail_('invalid_argument', 'เปลี่ยนสิทธิ์หรือปิดบัญชีของตัวเองไม่ได้');
    const losingAdmin = u.role === 'admin' && u.active && u.approved && (next.role !== 'admin' || !next.active);
    if (losingAdmin && activeAdmins() <= 1) throw fail_('last_admin', 'ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน');
    const changes = [];
    if (next.name !== u.name) changes.push({ f: 'name', label: 'ชื่อ-นามสกุล', from: u.name, to: next.name });
    if (next.role !== u.role) changes.push({ f: 'role', label: 'สิทธิ์', from: ROLE_TH[u.role], to: ROLE_TH[next.role] });
    if (next.active !== u.active) changes.push({ f: 'active', label: 'สถานะ', from: u.active ? 'ใช้งานได้' : 'ปิดใช้งาน', to: next.active ? 'ใช้งานได้' : 'ปิดใช้งาน' });
    const target = who_(u);
    u.name = next.name; u.role = next.role; u.active = next.active; u.updatedAt = now_();
    writeUser_(u);
    if (changes.length) {
      const act = changes.length === 1 && changes[0].f === 'active' ? (next.active ? 'user_enable' : 'user_disable')
        : changes.length === 1 && changes[0].f === 'role' ? 'user_role' : changes.length === 1 && changes[0].f === 'name' ? 'user_rename' : 'user_update';
      log_(me, act, { target: target, summary: 'แก้ไขบัญชี ' + target + ': ' + changes.map(c => c.label + ' ' + c.from + ' → ' + c.to).join(', '), changes: changes });
    }
    return { ok: true, user: publicUser_(u) };
  }

  if (action === 'users_delete') {
    if (u.username === me.username) throw fail_('invalid_argument', 'ลบบัญชีของตัวเองไม่ได้');
    if (u.role === 'admin' && u.active && u.approved && activeAdmins() <= 1) throw fail_('last_admin', 'ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน');
    sheet_(SHEET_USERS).deleteRow(u._row);
    log_(me, 'user_delete', { target: who_(u), summary: 'ลบบัญชี ' + who_(u) });
    return { ok: true };
  }
  return { ok: false, error: 'unknown_action' };
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

function createEntry_(data, me) {
  const sh = sheet_(SHEET_ENTRIES);
  ensureHeader_(sh, FIELDS); // เพิ่มคอลัมน์ใหม่ (เช่น docChannel) ให้อัตโนมัติ
  const o = clean_(data);
  o.id = Utilities.getUuid();
  o.source = 'web';
  o.createdAt = o.updatedAt = now_();
  o.createdBy = o.updatedBy = me ? me.name + ' (' + me.username + ')' : '';
  const row = rowFrom_(sh, o);
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  log_(me, 'entry_create', { target: o.title, entryId: o.id, entryDate: o.date,
    summary: 'เพิ่มงาน "' + o.title + '" วันที่ ' + o.date + ' · ' + o.teacherNames,
    changes: entryChanges_({}, o) });
  return o;
}

function updateEntry_(id, data, me) {
  if (!id) throw new Error('ไม่มี id');
  const sh = sheet_(SHEET_ENTRIES);
  ensureHeader_(sh, FIELDS);
  const r = findRow_(sh, id);
  if (r < 0) throw new Error('ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
  const hm = headerMap_(sh);
  const current = sh.getRange(r, 1, 1, hm.head.length).getDisplayValues()[0];
  const o = clean_(data);
  o.id = id;
  o.source = current[hm.map.source] || 'web';
  o.createdAt = current[hm.map.createdAt] || now_();
  o.updatedAt = now_();
  o.createdBy = current[hm.map.createdBy] || '';
  o.updatedBy = me ? me.name + ' (' + me.username + ')' : '';
  const row = rowFrom_(sh, o);
  // คงค่าคอลัมน์อื่นที่ผู้ใช้เพิ่มเองในชีต
  hm.head.forEach((h, i) => { if (FIELDS.indexOf(h) < 0) row[i] = current[i]; });
  sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  const before = {}; Object.keys(hm.map).forEach(k => { before[k] = current[hm.map[k]]; });
  before.date = normDate_(before.date);
  const changes = entryChanges_(before, o);
  if (changes.length) {
    log_(me, 'entry_update', { target: o.title, entryId: id, entryDate: o.date,
      summary: 'แก้ไขงาน "' + o.title + '" วันที่ ' + o.date + ': ' + changes.map(c => c.label).join(', '), changes: changes });
  }
  return o;
}

function deleteEntry_(id, me) {
  if (!id) throw new Error('ไม่มี id');
  const sh = sheet_(SHEET_ENTRIES);
  const r = findRow_(sh, id);
  if (r > 0) {
    const hm = headerMap_(sh);
    const cur = sh.getRange(r, 1, 1, hm.head.length).getDisplayValues()[0];
    const before = {}; Object.keys(hm.map).forEach(k => { before[k] = cur[hm.map[k]]; });
    sh.deleteRow(r);
    log_(me, 'entry_delete', { target: before.title, entryId: id, entryDate: normDate_(before.date),
      summary: 'ลบงาน "' + before.title + '" วันที่ ' + normDate_(before.date) + ' · ' + (before.teacherNames || showVal_('who', before.who)),
      changes: entryChanges_(before, {}) });
  }
}

// ทดสอบใน editor: ดูว่าอ่านข้อมูลได้กี่แถว
function testList() {
  Logger.log(readEntries_().length + ' รายการ, ' + Object.keys(readHolidays_()).length + ' วันหยุด');
}
