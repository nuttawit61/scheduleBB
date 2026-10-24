/*
 * นำเข้าตารางงานจากไฟล์ Excel แบบบันทึก TM-QM-F-092 (ไฟล์ที่ผู้ประสานงานกรอกเอง ชีตละอาจารย์ละเดือน)
 * ไฟล์นี้มีแต่ตรรกะ (อ่านไฟล์ → จับคู่กับงานในระบบ → สรุปสิ่งที่จะเพิ่ม/แก้) ไม่มีหน้าจอ
 * ใช้ในหน้า import.html และใช้ทดสอบใน Node ได้
 *
 * หลักการ
 *  - แต่ละแถวในไฟล์ = งาน 1 รายการของอาจารย์ 1 ท่าน งานร่วมที่พิมพ์ซ้ำในหลายชีต (วันเดียวกัน เวลาเริ่มเดียวกัน ชื่อใกล้กัน)
 *    จะรวมเป็นงานเดียวที่มีอาจารย์หลายท่าน และเก็บสถานะที่ต่างกันไว้ในสถานะรายบุคคล (statusBy)
 *  - จับคู่กับงานในระบบด้วย วันที่ + อาจารย์ + ชื่องาน (+ เวลาเริ่ม) เพราะไฟล์ไม่มีรหัสงาน
 *  - แก้เฉพาะช่องที่ในไฟล์มีค่าและต่างจากในระบบ ช่องว่างในไฟล์ไม่ลบข้อมูลในระบบ
 *  - ไม่ลบงานใด ๆ งานที่มีในระบบแต่ไม่มีในไฟล์ แสดงให้ตรวจเท่านั้น
 */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.TTImport = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const MONTHS_S = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const MONTH_KEY = {};
  MONTHS.forEach((m, i) => { MONTH_KEY[m] = i + 1; });
  MONTHS_S.forEach((m, i) => { MONTH_KEY[m.replace(/\./g, '')] = i + 1; });

  const STATUS_MAP = { 'รออาจารย์ยืนยัน': 'รอยืนยัน', 'รอการยืนยัน': 'รอยืนยัน', 'ยืนยันแล้ว': 'ยืนยัน', 'ยกเลิก': 'ยกเลิก' };
  const LABEL = {
    who: 'อาจารย์', time: 'เวลา', type: 'ประเภท', title: 'รายการ', place: 'สถานที่', status: 'สถานะ', hours: 'ชั่วโมง',
    level: 'ระดับการประชุม', inviter: 'หน่วยงานที่เชิญ', fund: 'ทุนสนับสนุน', rec: 'ผู้บันทึก', notes: 'รายละเอียดเพิ่มเติม'
  };
  const ONLINE_RE = /zoom|google\s*meet|\bmeet\b|teams|webex|ออนไลน์|online|ทางไกล/i;

  // ---------- เครื่องมือทั่วไป ----------
  const pad = n => String(n).padStart(2, '0');
  const thaiDigits = s => String(s == null ? '' : s).replace(/[๐-๙]/g, c => String(c.charCodeAt(0) - 0x0E50));
  const str = v => (v == null ? '' : typeof v === 'number' ? String(v) : String(v)).replace(/ /g, ' ').trim();
  const collapse = s => str(s).replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const isBlank = v => { const s = str(v); return !s || s === '-' || s === '–'; };
  const normKey = s => thaiDigits(s).toLowerCase().replace(/[^0-9a-z฀-๿]+/g, '');

  function bigrams(s) { const out = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); } return out; }
  // ความคล้ายของชื่องาน 0..1 (Dice บนตัวอักษรคู่ + กรณีชื่อหนึ่งอยู่ในอีกชื่อหนึ่ง)
  function sim(a, b) {
    const x = normKey(a), y = normKey(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    const [s, l] = x.length <= y.length ? [x, y] : [y, x];
    let best = 0;
    if (s.length >= 4 && l.indexOf(s) >= 0) best = s.length / l.length >= 0.6 ? 0.9 + 0.09 * (s.length / l.length) : 0.5 + 0.4 * (s.length / l.length);
    if (x.length < 2 || y.length < 2) return best;
    const A = bigrams(x), B = bigrams(y);
    let inter = 0; A.forEach((n, g) => { if (B.has(g)) inter += Math.min(n, B.get(g)); });
    return Math.max(best, (2 * inter) / (x.length - 1 + y.length - 1));
  }

  function isoOf(y, m, d) {
    y = +y; m = +m; d = +d;
    if (y < 100) y += 2500;            // 69 → 2569
    if (y > 2400) y -= 543;            // พ.ศ. → ค.ศ.
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1900 && y < 2200)) return '';
    const dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1) return '';
    return y + '-' + pad(m) + '-' + pad(d);
  }

  // "1 ตุลาคม 2569", "1 ต.ค. 69", "1/10/2569", วันที่แบบตัวเลขของ Excel
  function parseThaiDate(v, XLSX) {
    if (v instanceof Date && !isNaN(v)) return isoOf(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000 && XLSX && XLSX.SSF) { const p = XLSX.SSF.parse_date_code(v); if (p) return isoOf(p.y, p.m, p.d); }
      return '';
    }
    const s = thaiDigits(v).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    let m = s.match(/(\d{1,2})\s*([ก-๛][ก-๛.\s]*?)\s*(\d{2,4})(?!\d)/);
    if (m) { const mo = MONTH_KEY[m[2].replace(/[.\s]/g, '')] || MONTH_KEY[m[2].trim()]; if (mo) return isoOf(m[3], mo, m[1]); }
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (m) return isoOf(m[3], m[2], m[1]);
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return isoOf(m[1], m[2], m[3]);
    return '';
  }

  function hm(h, m) { h = +h; m = +m; if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) return ''; return pad(h) + ':' + pad(m); }
  const dot = t => t ? t.replace(':', '.') : '';
  function numTime(v) { if (typeof v !== 'number' || !(v >= 0 && v < 24)) return ''; const h = Math.floor(v + 1e-9); return hm(h, Math.round((v - h) * 100)); }

  // เวลาเขียนได้หลายแบบ: "09.00 - 12.00 ", "9.00-12.30น.", "09.00-10.00 (พร้อมกัน 8.50 น.)", 7.15 (ตัวเลข)
  function parseTime(c, endCell) {
    let start = '', end = '', extra = '', raw = '';
    if (typeof c === 'number') {
      start = numTime(c); raw = String(c);
      if (start && typeof endCell === 'number' && endCell > c) end = numTime(endCell);
    } else {
      raw = collapse(c).replace(/\n/g, ' ');
      const t = thaiDigits(raw);
      const R = /(\d{1,2})\s*[.:]\s*(\d{2})\d?\s*(?:น\.?)?\s*(?:-|–|—|ถึง)\s*(\d{1,2})\s*[.:]\s*(\d{2})\d?/;  // \d? กันพิมพ์เกิน เช่น 11.000
      let m = t.match(R), rest = t;
      if (m) { start = hm(m[1], m[2]); end = hm(m[3], m[4]); rest = t.replace(m[0], ' '); }
      else if ((m = t.match(/(\d{1,2})\s*[.:]\s*(\d{2})/))) { start = hm(m[1], m[2]); rest = t.replace(m[0], ' '); }
      if (start && end && end <= start) end = '';
      extra = rest.replace(/^\s*น\.?/, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
      if (/^(น\.?|-)?$/.test(extra)) extra = '';
      if (!start) extra = '';
    }
    const time = start ? (end ? dot(start) + '-' + dot(end) : dot(start)) : raw;
    return { time, start, end, extra };
  }

  function parseHours(v) {
    if (typeof v === 'number') return v > 0 && v < 48 ? v : null;
    const s = thaiDigits(v).replace(/ชม\.?|ชั่วโมง/g, '').trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const n = parseFloat(s); return n > 0 && n < 48 ? n : null;
  }
  const fmtHours = n => n == null ? '' : (Math.round(n * 2) === n * 2 ? n.toFixed(1) : String(+n.toFixed(2)));

  function normStatus(v) { const s = collapse(v); return STATUS_MAP[s] || s; }
  function normLevel(v, colMeaning) {
    const s = collapse(v);
    if (isBlank(s)) return '';
    if (s.length <= 2 && !/[ก-ฮa-z]{2}/i.test(s)) return colMeaning;  // ช่องติ๊ก (✓ / ü)
    if (s === 'ภาค') return 'ภาควิชาฯ';
    if (s === 'คกก') return 'คกก.';
    return s;
  }

  // ---------- อ่านไฟล์ ----------
  const DEFAULT_COLS = { day: 0, date: 1, time: 2, type: 3, title: 4, place: 5, status: 6, hours: 7, lv1: 8, lv2: 9, lv3: 10, inviter: 11, fund: 16, rec: 17, end2: 18 };

  function findCols(rows) {
    const c = Object.assign({}, DEFAULT_COLS);
    for (let r = 0; r < Math.min(rows.length, 8); r++) {
      (rows[r] || []).forEach((v, i) => {
        const s = collapse(v);
        if (s === 'วัน/เดือน/ปี') c.date = i;
        else if (s === 'เวลา') c.time = i;
        else if (s === 'ประเภท') c.type = i;
        else if (s === 'รายการ') c.title = i;
        else if (s === 'สถานที่') c.place = i;
        else if (s === 'หมายเหตุ') c.status = i;
        else if (s === 'นาที/ชม.') c.hours = i;
        else if (s === 'ระดับของการประชุม') { c.lv1 = i; c.lv2 = i + 1; c.lv3 = i + 2; }
        else if (s === 'หน่วยงานที่เชิญ') c.inviter = i;
        else if (/^ทุนสนับสนุน/.test(s)) { c.fund = i; c.rec = i + 1; c.end2 = i + 2; }
      });
    }
    return c;
  }
  function headerRow(rows) {
    for (let r = 0; r < Math.min(rows.length, 10); r++) if ((rows[r] || []).some(v => collapse(v) === 'รายการ')) return r;
    return 3;
  }

  function firstName(full) { const t = collapse(full).split(' ')[0] || ''; return t.replace(/^.*\./, ''); }
  function lastName(full) { const p = collapse(full).split(' '); return p.length > 1 ? p[p.length - 1] : ''; }

  // หาว่าชีตนี้เป็นของอาจารย์ท่านไหน: ดูชื่อในหัวกระดาษก่อน แล้วค่อยดูชื่อชีต (AJ1 → AJ)
  function detectTeacher(sheetName, rows, teachers) {
    let headerName = '';
    for (let r = 0; r < Math.min(rows.length, 5); r++) {
      for (const v of rows[r] || []) {
        const s = collapse(v);
        if (!s || s.length > 80) continue;
        for (const code of Object.keys(teachers)) {
          const n = teachers[code].name, fn = firstName(n), ln = lastName(n);
          if (fn && ln && s.indexOf(fn) >= 0 && s.indexOf(ln) >= 0) return { code, headerName: s };
        }
        if (!headerName && /(พญ|นพ|อ|ดร|ผศ|รศ|ศ)\.\s*[ก-ฮ]/.test(s) && /\s/.test(s)) headerName = s;
      }
    }
    const m = String(sheetName).trim().toUpperCase().match(/^([A-Z]+)/);
    if (!headerName && m && teachers[m[1]]) return { code: m[1], headerName: '' };
    return { code: '', headerName: headerName || String(sheetName) };
  }

  /**
   * อ่านทุกชีตของไฟล์
   * @returns {{rows:Array, sheets:Array, warnings:Array}}
   */
  function parseWorkbook(wb, XLSX, teachers) {
    const out = { rows: [], sheets: [], warnings: [] };
    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
      const info = { name, code: '', teacher: '', month: '', rows: 0, skipped: '' };
      out.sheets.push(info);
      if (!rows.length) { info.skipped = 'ชีตว่าง'; return; }
      const t = detectTeacher(name, rows, teachers);
      if (!t.code) { info.skipped = 'ไม่พบอาจารย์ "' + t.headerName + '" ในระบบ'; info.teacher = t.headerName; return; }
      info.code = t.code; info.teacher = teachers[t.code].name;
      const C = findCols(rows), h0 = headerRow(rows);
      const monthCount = {};
      let curDate = '';
      for (let r = h0 + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const cell = k => row[C[k]];
        if (collapse(cell('date')) === 'ประเภท' && collapse(cell('time')) === 'สี') break;      // ตารางสีท้ายแบบฟอร์ม
        const first = collapse(row[0]);
        if (/^หมายเหตุ/.test(first)) continue;
        const dRaw = cell('date');
        if (!isBlank(dRaw)) {
          const d = parseThaiDate(dRaw, XLSX);
          if (d) { curDate = d; monthCount[d.slice(0, 7)] = (monthCount[d.slice(0, 7)] || 0) + 1; }
          else if (!isBlank(cell('title'))) out.warnings.push({ sheet: name, row: r + 1, msg: 'อ่านวันที่ "' + collapse(dRaw) + '" ไม่ได้ ข้ามแถวนี้' });
          if (!d) { curDate = ''; }
        }
        const title = collapse(cell('title'));
        if (!title) continue;                                  // วันว่าง / วันหยุด
        if (!curDate) { out.warnings.push({ sheet: name, row: r + 1, msg: 'ไม่ทราบวันที่ของงาน "' + title.slice(0, 60) + '" ข้ามแถวนี้' }); continue; }
        const tm = parseTime(cell('time'), cell('end2'));
        const hrs = parseHours(cell('hours'));
        const level = normLevel(cell('lv1'), 'คณะฯ') || normLevel(cell('lv2'), 'ชาติ') || normLevel(cell('lv3'), 'นานาชาติ');
        const rec = collapse(cell('rec'));
        const fund = collapse(cell('fund'));
        out.rows.push({
          id: name + '!' + (r + 1), sheet: name, row: r + 1, w: t.code, date: curDate,
          time: tm.time, start: tm.start, end: tm.end, extra: tm.extra,
          type: collapse(cell('type')), title, place: collapse(cell('place')),
          status: normStatus(cell('status')), statusRaw: collapse(cell('status')),
          hours: fmtHours(hrs), level, inviter: collapse(cell('inviter')),
          fund: isBlank(fund) ? '' : fund, rec, recName: /^[ก-๛A-Za-z]/.test(rec) ? rec.split(/[\s,]+/)[0] : ''
        });
        info.rows++;
      }
      const months = Object.keys(monthCount).sort((a, b) => monthCount[b] - monthCount[a]);
      info.month = months[0] || '';
      if (!info.rows && !info.month) info.skipped = info.skipped || 'ไม่พบรายการงาน';
    });
    // งานที่หลุดเดือน (เช่น งาน ม.ค. ในชีต ธ.ค.) ยังนำเข้า แต่ไม่ใช้ตรวจ "งานที่ไม่มีในไฟล์"
    return out;
  }

  // ---------- จับคู่กับงานในระบบ ----------
  function parseSB(v) { if (!v) return {}; if (typeof v === 'object') return v; try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : {}; } catch (_) { return {}; } }
  function whoOf(e) { return Array.isArray(e.who) ? e.who.slice() : String(e.who || '').split(/[,\s]+/).filter(Boolean); }
  function entryStart(e) { if (e.start) return String(e.start).slice(0, 5); return parseTime(e.time || '').start; }
  function entryEnd(e) { if (e.end) return String(e.end).slice(0, 5); return parseTime(e.time || '').end; }
  function effStatus(e) { const sb = parseSB(e.statusBy), out = {}; whoOf(e).forEach(w => { out[w] = sb[w] || e.status || ''; }); return out; }

  function matchScore(row, e) {
    const s = sim(row.title, e.title);
    const es = entryStart(e);
    const same = !!(row.start && es && row.start === es);
    const ok = s >= 0.85 || (s >= 0.5 && same) || (s >= 0.35 && same && row.end && row.end === entryEnd(e));
    return ok ? s + (same ? 0.25 : 0) : -1;
  }

  // ตัวเลือกงานเดิมที่จับคู่ด้วยมือได้ (วันเดียวกัน อาจารย์ท่านเดียวกัน)
  function candidates(row, existing) {
    return existing.filter(e => e.date === row.date && whoOf(e).indexOf(row.w) >= 0)
      .map(e => ({ e, s: sim(row.title, e.title) })).sort((a, b) => b.s - a.s);
  }

  function clusterRows(rows) {
    const parent = rows.map((_, i) => i), members = rows.map((r, i) => new Set([r.w]));
    const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
    const byDay = {};
    rows.forEach((r, i) => { (byDay[r.date] = byDay[r.date] || []).push(i); });
    Object.keys(byDay).forEach(d => {
      const idx = byDay[d], pairs = [];
      for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) {
        const x = rows[idx[a]], y = rows[idx[b]];
        if (x.w === y.w || x.start !== y.start) continue;
        const s = sim(x.title, y.title);
        if (s >= 0.8) pairs.push([s, idx[a], idx[b]]);
      }
      pairs.sort((p, q) => q[0] - p[0]).forEach(([, a, b]) => {
        const ra = find(a), rb = find(b); if (ra === rb) return;
        for (const w of members[rb]) if (members[ra].has(w)) return;   // อาจารย์ท่านเดียวกันห้ามอยู่ในกลุ่มเดียวกันสองแถว
        parent[rb] = ra; members[rb].forEach(w => members[ra].add(w));
      });
    });
    const groups = {};
    rows.forEach((r, i) => { const k = find(i); (groups[k] = groups[k] || []).push(r); });
    return Object.values(groups);
  }

  function pickMain(eff, prefer, order) {
    const cnt = {}; Object.values(eff).forEach(s => { if (s) cnt[s] = (cnt[s] || 0) + 1; });
    const keys = Object.keys(cnt); if (!keys.length) return prefer || '';
    const max = Math.max.apply(null, keys.map(k => cnt[k]));
    const top = keys.filter(k => cnt[k] === max);
    if (prefer && top.indexOf(prefer) >= 0) return prefer;
    for (const w of order) if (eff[w] && top.indexOf(eff[w]) >= 0) return eff[w];
    return top[0];
  }
  function sbJSON(eff, main, who) {
    if (who.length < 2) return '';
    const o = {}; who.forEach(w => { if (eff[w] && eff[w] !== main) o[w] = eff[w]; });
    return Object.keys(o).length ? JSON.stringify(o) : '';
  }

  // ค่าของช่องจากหลายแถว (งานร่วม): ใช้ค่าจากอาจารย์ท่านแรกตามลำดับ และจดไว้ถ้าแถวอื่นเขียนไม่ตรงกัน
  function fieldFrom(rows, f, conflicts, short) {
    let val = '', from = null;
    rows.forEach(r => {
      const v = r[f]; if (!v) return;
      if (!from) { val = v; from = r; return; }
      const same = f === 'hours' ? Math.abs(parseFloat(v) - parseFloat(val)) < 0.01 : collapse(v) === collapse(val);
      if (!same) conflicts.push(LABEL[f] + ': ' + short(from.w) + ' "' + val + '" / ' + short(r.w) + ' "' + v + '"');
    });
    return val;
  }

  const eq = (f, a, b) => f === 'hours' ? (a === '' && b === '' ? true : Math.abs((parseFloat(a) || 0) - (parseFloat(b) || 0)) < 0.01 && (a === '') === (b === '')) : collapse(a) === collapse(b);

  /**
   * สรุปสิ่งที่จะเปลี่ยน
   * @param rows      แถวจาก parseWorkbook
   * @param existing  งานในระบบ (จาก action list)
   * @param opts      { teachers, order, force: {rowId: entryId|'new'}, coverage: {AJ:['2026-10',...]} }
   */
  function buildPlan(rows, existing, opts) {
    opts = opts || {};
    const teachers = opts.teachers || {}, order = opts.order || Object.keys(teachers), force = opts.force || {};
    const short = w => (teachers[w] && (teachers[w].short || teachers[w].name)) || w;
    const ordIdx = w => { const i = order.indexOf(w); return i < 0 ? 99 : i; };
    const sortRows = rs => rs.slice().sort((a, b) => ordIdx(a.w) - ordIdx(b.w));
    const byId = new Map(existing.map(e => [e.id, e]));
    const warnings = [];

    // งานซ้ำในชีตเดียวกัน
    const seen = {};
    rows.forEach(r => {
      const k = r.w + '|' + r.date + '|' + r.start;
      (seen[k] = seen[k] || []).forEach(o => { if (sim(o.title, r.title) >= 0.9) warnings.push({ sheet: r.sheet, row: r.row, msg: 'อาจพิมพ์ซ้ำกับแถว ' + o.row + ' ("' + r.title.slice(0, 50) + '")' }); });
      seen[k].push(r);
    });

    // 1) จับคู่แถว ↔ งานในระบบ (ทีละอาจารย์)
    const match = new Map();      // row.id → entry id
    const taken = new Set();      // entryId|w
    rows.forEach(r => {
      const f = force[r.id];
      if (f && f !== 'new' && byId.has(f)) { match.set(r.id, f); taken.add(f + '|' + r.w); }
    });
    const pairs = [];
    rows.forEach(r => {
      if (force[r.id]) return;
      existing.forEach(e => {
        if (e.date !== r.date || whoOf(e).indexOf(r.w) < 0) return;
        const s = matchScore(r, e); if (s >= 0) pairs.push([s, r, e]);
      });
    });
    pairs.sort((a, b) => b[0] - a[0]).forEach(([, r, e]) => {
      if (match.has(r.id) || taken.has(e.id + '|' + r.w)) return;
      match.set(r.id, e.id); taken.add(e.id + '|' + r.w);
    });

    // 2) รวมแถวงานร่วม แล้วตัดสินว่าแถวที่ยังไม่มีคู่จะ "เพิ่มอาจารย์ในงานเดิม" หรือ "สร้างงานใหม่"
    const target = new Map();      // entryId → rows
    const creates = [];
    clusterRows(rows).forEach(group => {
      const matched = group.filter(r => match.has(r.id)), un = group.filter(r => !match.has(r.id));
      matched.forEach(r => { const id = match.get(r.id); (target.get(id) || target.set(id, []).get(id)).push(r); });
      const ids = [...new Set(matched.map(r => match.get(r.id)))];
      const canJoin = un.filter(r => force[r.id] !== 'new'), mustNew = un.filter(r => force[r.id] === 'new');
      if (ids.length === 1 && canJoin.length) {
        canJoin.forEach(r => { r._join = true; target.get(ids[0]).push(r); });
        if (mustNew.length) creates.push(makeCreate(mustNew));
      } else if (!ids.length && canJoin.length && !mustNew.length && joinExisting(canJoin)) {
        // งานเดียวกันมีอยู่แล้วในระบบของอาจารย์ท่านอื่น (เช่น นำเข้าไฟล์ของอีกท่านไปก่อน) → เพิ่มอาจารย์เข้างานเดิม ไม่สร้างรายการแยก
        const e = joinExisting(canJoin);
        canJoin.forEach(r => { r._join = true; (target.get(e.id) || target.set(e.id, []).get(e.id)).push(r); });
      } else if (un.length) creates.push(makeCreate(un));
    });

    // งานในระบบที่น่าจะเป็นงานเดียวกับแถวกลุ่มนี้ แต่ยังไม่มีอาจารย์ท่านนี้: วันเดียวกัน ชื่อคล้ายมาก (≥0.85) และเวลาเริ่มตรงกัน (หรือฝั่งใดไม่ได้ใส่เวลา)
    function joinExisting(rs) {
      const base = rs[0], ws = rs.map(r => r.w);
      let best = null, bs = 0;
      existing.forEach(e => {
        if (e.date !== base.date || whoOf(e).some(w => ws.indexOf(w) >= 0)) return;
        const es = entryStart(e);
        if (base.start && es && base.start !== es) return;
        const s = sim(base.title, e.title);
        if (s >= 0.85 && s > bs) { best = e; bs = s; }
      });
      return best;
    }

    function makeCreate(rs) {
      rs = sortRows(rs);
      const conflicts = [], who = [...new Set(rs.map(r => r.w))];
      const v = f => fieldFrom(rs, f, conflicts, short);
      const base = rs[0];
      const eff = {}; rs.forEach(r => { if (r.status) eff[r.w] = r.status; });
      const status = pickMain(eff, '', order);
      const place = v('place'), online = ONLINE_RE.test(place);
      const data = {
        who, date: base.date, time: base.time, start: base.start, end: base.end, hours: v('hours'), type: v('type'), title: base.title,
        mode: place && !online ? 'onsite' : '', venue: place && !online ? place : '', place,
        platform: '', link: '', meetingId: '', passcode: '',
        status, statusBy: sbJSON(eff, status, who), level: v('level'), inviter: v('inviter'), fund: v('fund'),
        docChannel: '', edoc: '', notes: base.extra ? 'เวลา: ' + base.extra : '', recName: base.recName, rec: base.rec
      };
      rs.forEach(r => { if (r !== base && (r.start !== base.start || r.end !== base.end)) conflicts.push('เวลา: ' + short(base.w) + ' "' + base.time + '" / ' + short(r.w) + ' "' + r.time + '"'); });
      const cands = [];
      rs.forEach(r => candidates(r, existing).forEach(c => { if (!cands.some(x => x.e.id === c.e.id)) cands.push({ e: c.e, s: c.s, rowId: r.id }); }));
      return { kind: 'create', key: 'c:' + rs.map(r => r.id).join(','), rows: rs, data, conflicts, cands: cands.sort((a, b) => b.s - a.s).slice(0, 6) };
    }

    // 3) คำนวณการแก้ไขของงานเดิมแต่ละรายการ
    const updates = [], unchanged = [];
    target.forEach((rs, id) => {
      const e = byId.get(id); if (!e) return;
      rs = sortRows(rs);
      const conflicts = [], changes = [], notes = [];
      const v = f => fieldFrom(rs, f, conflicts, short);
      const base = rs[0];
      const after = Object.assign({}, e, { who: whoOf(e) });
      const set = (f, val, label) => {
        const from = e[f] == null ? '' : String(e[f]);
        if (!val || eq(f, from, val)) return;
        after[f] = val; changes.push({ f, label: label || LABEL[f] || f, from, to: val });
      };
      // ช่องทั่วไป
      set('title', base.title);
      // ประเภทงาน: ถ้างานในระบบจัดเป็นประเภทตามข้อ 5 แล้ว (assets/worktypes.js) แต่ไฟล์ Excel ยังเป็นประเภทเดิม เช่น "ประชุม" → ไม่แก้ทับ
      { const ft = v('type'), isW = (typeof globalThis !== 'undefined' && globalThis.isWorkType) || null;
        if (!(isW && isW(e.type) && !isW(ft))) set('type', ft); }
      set('hours', v('hours'));
      set('level', v('level'));
      set('inviter', v('inviter'));
      set('fund', v('fund'));
      // เวลา
      if (base.start) {
        const es = entryStart(e), ee = entryEnd(e);
        if (base.start !== es || (base.end && base.end !== ee)) {
          after.start = base.start; after.end = base.end || (base.start === es ? ee : ''); after.time = base.start ? (after.end ? dot(after.start) + '-' + dot(after.end) : dot(after.start)) : base.time;
          changes.push({ f: 'time', label: LABEL.time, from: e.time || (es ? dot(es) + (ee ? '-' + dot(ee) : '') : ''), to: after.time });
        }
      }
      rs.forEach(r => { if (r !== base && r.start && (r.start !== base.start || r.end !== base.end)) conflicts.push('เวลา: ' + short(base.w) + ' "' + base.time + '" / ' + short(r.w) + ' "' + r.time + '"'); });
      // สถานที่: งานที่บันทึกเป็นออนไลน์/ไฮบริดในหน้าเว็บมีรายละเอียดแยกช่อง ไม่แก้ทับ
      const place = v('place');
      if (place) {
        if (!e.mode || e.mode === 'onsite') {
          const cur = e.mode === 'onsite' ? (e.venue || e.place || '') : (e.place || '');
          if (!eq('place', cur, place)) {
            after.place = place; if (e.mode === 'onsite') after.venue = place;
            changes.push({ f: 'place', label: LABEL.place, from: cur, to: place });
          }
        } else if (!eq('place', e.place, place)) notes.push('สถานที่ในไฟล์ต่างจากในระบบ แต่งานนี้บันทึกเป็นแบบ' + (e.mode === 'online' ? 'ออนไลน์' : 'ไฮบริด') + 'ไว้ จึงไม่แก้ช่องสถานที่');
      }
      // อาจารย์ที่เพิ่มเข้ามา
      const joined = rs.filter(r => r._join && after.who.indexOf(r.w) < 0).map(r => r.w);
      if (joined.length) {
        const fromWho = after.who.slice();
        after.who = after.who.concat(joined).sort((a, b) => ordIdx(a) - ordIdx(b));
        changes.push({ f: 'who', label: LABEL.who, from: fromWho.map(short).join(', '), to: after.who.map(short).join(', ') });
      }
      // สถานะ (รายบุคคล)
      const effBefore = effStatus(e), eff = {};
      after.who.forEach(w => { eff[w] = effBefore[w] || e.status || ''; });
      rs.forEach(r => { if (r.status) eff[r.w] = r.status; });
      const main = pickMain(eff, e.status, order);
      const sb = sbJSON(eff, main, after.who);
      const multi = after.who.length > 1;
      after.who.forEach(w => {
        const was = joined.indexOf(w) >= 0 ? '' : (effBefore[w] || '');
        if (eff[w] !== was && !(joined.indexOf(w) >= 0 && !eff[w])) changes.push({ f: 'status', label: multi ? 'สถานะ ' + short(w) : LABEL.status, from: was, to: eff[w] || '' });
      });
      after.status = main; after.statusBy = sb;
      // ผู้บันทึก: เปลี่ยนตามไฟล์เฉพาะเมื่อมีการแก้อย่างอื่นด้วย
      if (changes.length && base.rec && !eq('rec', e.rec || '', base.rec)) { changes.push({ f: 'rec', label: LABEL.rec, from: e.rec || '', to: base.rec }); after.rec = base.rec; after.recName = base.recName || e.recName || ''; }
      const item = { kind: 'update', key: 'u:' + id, id, entry: e, rows: rs, after, changes, conflicts, notes };
      (changes.length ? updates : unchanged).push(item);
    });

    // 4) งานที่มีในระบบแต่ไม่มีในไฟล์ (เฉพาะอาจารย์และเดือนที่ไฟล์ครอบคลุม)
    const coverage = opts.coverage || {};
    const missing = [];
    existing.forEach(e => {
      const ws = whoOf(e).filter(w => (coverage[w] || []).indexOf(String(e.date).slice(0, 7)) >= 0 && !taken.has(e.id + '|' + w));
      if (ws.length) missing.push({ entry: e, who: ws });
    });
    missing.sort((a, b) => (a.entry.date + (entryStart(a.entry) || '')).localeCompare(b.entry.date + (entryStart(b.entry) || '')));

    creates.sort((a, b) => (a.data.date + a.data.start).localeCompare(b.data.date + b.data.start));
    updates.sort((a, b) => (a.after.date + (a.after.start || '')).localeCompare(b.after.date + (b.after.start || '')));
    return { creates, updates, unchanged, missing, warnings };
  }

  function coverageOf(sheets) {
    const c = {};
    sheets.forEach(s => { if (s.code && s.month) (c[s.code] = c[s.code] || []).indexOf(s.month) < 0 && c[s.code].push(s.month); });
    return c;
  }

  const EDITABLE = ['who', 'date', 'time', 'start', 'end', 'hours', 'type', 'title', 'mode', 'venue', 'place', 'platform', 'link', 'meetingId', 'passcode',
    'status', 'level', 'inviter', 'fund', 'docChannel', 'edoc', 'notes', 'recName', 'rec', 'statusBy'];
  function pick(o) { const out = {}; EDITABLE.forEach(f => { out[f] = o[f] == null ? '' : o[f]; }); return out; }

  // ข้อมูลที่ส่งให้ Apps Script
  function payload(plan, chosen) {
    return {
      creates: plan.creates.filter(c => chosen.has(c.key)).map(c => ({ key: c.key, data: pick(c.data) })),
      updates: plan.updates.filter(u => chosen.has(u.key)).map(u => ({ key: u.key, id: u.id, expect: u.entry.updatedAt || '', data: pick(u.after) }))
    };
  }

  return { parseWorkbook, buildPlan, coverageOf, payload, parseTime, parseThaiDate, sim, candidates, whoOf, entryStart, LABEL, _internal: { normStatus, parseHours, fmtHours, clusterRows } };
});
