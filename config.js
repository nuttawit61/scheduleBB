// ตั้งค่าการเชื่อมต่อ Google Sheet
// วาง URL ของ Apps Script Web App (ลงท้ายด้วย /exec) แทนข้อความด้านล่าง
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbws8mCqL4sc4CqwP_VSZdVRbyZYTu6DEB2F6ERCFVC2JbuB4nI_2TB0zhJ-xPPOwRkj/exec',
  // ออกจากระบบอัตโนมัติเมื่อไม่มีการใช้งานเกินกี่นาที (ใส่ 0 = ปิด)
  IDLE_MINUTES: 30
};
