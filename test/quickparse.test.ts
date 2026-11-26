import { describe, expect, it } from "vitest";
import { quickParse } from "../src/quickparse";
import { fromLocal } from "../src/time";

// พฤหัสบดี 26 พ.ย. 2026 15:00 เวลาไทย
const NOW = fromLocal(2026, 11, 26, 15, 0);
const q = (s: string) => quickParse(s, NOW);

describe("quickParse", () => {
  it.each([
    ["27/11 20:00 ส่งรายงาน", "2026-11-27", "20:00", "ส่งรายงาน"],
    ["พรุ่งนี้ 9 โมง ประชุมทีม", "2026-11-27", "09:00", "ประชุมทีม"],
    ["พรุ่งนี้ 2 ทุ่มครึ่ง โทรหาลูกค้า", "2026-11-27", "20:30", "โทรหาลูกค้า"],
    ["มะรืนนี้ บ่าย 3 ส่งเอกสาร", "2026-11-28", "15:00", "ส่งเอกสาร"],
    ["วันศุกร์ เที่ยง กินข้าวทีม", "2026-11-27", "12:00", "กินข้าวทีม"],
    ["ศุกร์หน้า 4 โมงเย็น ปิดงาน", "2026-12-04", "16:00", "ปิดงาน"],
    ["1 ธ.ค. 8.30 น. ตรวจสต็อก", "2026-12-01", "08:30", "ตรวจสต็อก"],
    ["วันที่ 5/1/2570 ตี 5 ออกเดินทาง", "2027-01-05", "05:00", "ออกเดินทาง"],
    ["บ่ายโมง ประชุม", "", "13:00", "ประชุม"],
    ["3 โมง เช็กของ", "", "15:00", "เช็กของ"],
    ["ส่งงานตอน 17:00", "", "17:00", "ส่งงาน"],
  ])("%s", (input, date, time, text) => {
    expect(q(input)).toMatchObject({ date, time, text, repeat: "none", in_minutes: 0 });
  });

  it("rolls a past day/month to next year", () => {
    expect(q("1/1 9:00 ปีใหม่")?.date).toBe("2027-01-01");
  });

  it("reads relative times", () => {
    expect(q("อีก 30 นาที โทรกลับ")).toMatchObject({ in_minutes: 30, text: "โทรกลับ" });
    expect(q("อีก 2 ชั่วโมงครึ่ง ปิดเครื่อง")).toMatchObject({ in_minutes: 150, text: "ปิดเครื่อง" });
  });

  it("reads repeats", () => {
    expect(q("ทุกวันศุกร์ บ่าย 3 ส่งรายงาน")).toMatchObject({ repeat: "weekly", date: "2026-11-27", time: "15:00", text: "ส่งรายงาน" });
    expect(q("ทุกวันทำงาน 8 โมงเช้า เช็กอีเมล")).toMatchObject({ repeat: "weekdays", time: "08:00", text: "เช็กอีเมล" });
    expect(q("ทุกวันที่ 25 10:00 จ่ายค่าเช่า")).toMatchObject({ repeat: "monthly", date: "2026-12-25", text: "จ่ายค่าเช่า" });
    expect(q("ทุกวัน 2 ทุ่ม กินยา")).toMatchObject({ repeat: "daily", time: "20:00", text: "กินยา" });
  });

  it("flags mention-all", () => {
    expect(q("ทุกคน 30/11 20:00 ปิดระบบ")).toMatchObject({ mention_all: true, text: "ปิดระบบ" });
  });

  it("gives up when there is no time or no subject", () => {
    expect(q("ช่วยจำว่าลูกค้าชอบกาแฟ")).toBeNull();
    expect(q("พรุ่งนี้ 9 โมง")).toBeNull();
    expect(q("31/2 9:00 วันที่ไม่มีจริง")).toBeNull();
  });
});
