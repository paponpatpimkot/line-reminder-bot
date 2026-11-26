// เวลาไทย (Asia/Bangkok) เป็น UTC+7 ตลอดปี ไม่มี daylight saving จึงคำนวณด้วยการบวกลบ 7 ชั่วโมงได้ตรงๆ
const OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Repeat = "none" | "daily" | "weekdays" | "weekly" | "monthly";

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = อาทิตย์
}

export function toLocal(ms: number): LocalParts {
  const d = new Date(ms + OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

export function fromLocal(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour, minute) - OFFSET_MS;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "2026-11-27" -> [2026, 11, 27] ; รับปี พ.ศ. ได้ด้วย */
export function parseDate(s: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  let y = Number(m[1]);
  if (y > 2400) y -= 543;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return [y, mo, d];
}

/** "20:30" หรือ "20.30" -> [20, 30] */
export function parseClock(s: string): [number, number] | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return [h, min];
}

export function isoLocalDate(ms: number): string {
  const p = toLocal(ms);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * คำนวณเวลาเตือนจากผลที่ AI แยกได้
 * - inMinutes > 0 = "อีก N นาที"
 * - ไม่มีวันที่ = วันนี้ ถ้าเวลายังไม่ผ่าน ไม่อย่างนั้นพรุ่งนี้
 */
export function resolveFireAt(
  now: number,
  date: string,
  clock: string,
  inMinutes: number,
  defaultClock: string,
): { fireAt: number; usedDefaultTime: boolean } | null {
  if (inMinutes > 0) return { fireAt: now + inMinutes * 60_000, usedDefaultTime: false };

  let usedDefaultTime = false;
  let hm = clock ? parseClock(clock) : null;
  if (clock && !hm) return null;
  if (!hm) {
    hm = parseClock(defaultClock) ?? [8, 0];
    usedDefaultTime = true;
  }

  if (date) {
    const ymd = parseDate(date);
    if (!ymd) return null;
    return { fireAt: fromLocal(ymd[0], ymd[1], ymd[2], hm[0], hm[1]), usedDefaultTime };
  }

  const today = toLocal(now);
  let fireAt = fromLocal(today.year, today.month, today.day, hm[0], hm[1]);
  if (fireAt <= now) fireAt += DAY_MS;
  return { fireAt, usedDefaultTime };
}

/** เวลาเตือนรอบถัดไปของการเตือนซ้ำ ข้ามรอบที่ผ่านไปแล้ว (เช่น ตอนระบบล่ม) */
export function nextOccurrence(fireAt: number, repeat: Repeat, anchorDay: number | null, now: number): number | null {
  if (repeat === "none") return null;
  let next = fireAt;
  for (let guard = 0; guard < 1000; guard++) {
    next = step(next, repeat, anchorDay);
    if (next > now) return next;
  }
  return null;
}

function step(ms: number, repeat: Repeat, anchorDay: number | null): number {
  switch (repeat) {
    case "daily":
      return ms + DAY_MS;
    case "weekly":
      return ms + 7 * DAY_MS;
    case "weekdays": {
      let next = ms + DAY_MS;
      while ([0, 6].includes(toLocal(next).weekday)) next += DAY_MS;
      return next;
    }
    case "monthly": {
      const p = toLocal(ms);
      const year = p.month === 12 ? p.year + 1 : p.year;
      const month = p.month === 12 ? 1 : p.month + 1;
      const day = Math.min(anchorDay ?? p.day, daysInMonth(year, month));
      return fromLocal(year, month, day, p.hour, p.minute);
    }
    default:
      return ms;
  }
}

/** จำนวนครั้งโดยประมาณต่อเดือน ใช้เตือนเรื่องโควตาตอนตั้งเตือนซ้ำ */
export function timesPerMonth(repeat: Repeat): number {
  return { none: 1, daily: 30, weekdays: 22, weekly: 4.3, monthly: 1 }[repeat];
}

const TH_DAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const TH_DAYS_FULL = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** "พฤ. 27 พ.ย. 2569 เวลา 20:00" */
export function formatThai(ms: number): string {
  const p = toLocal(ms);
  const hh = String(p.hour).padStart(2, "0");
  const mm = String(p.minute).padStart(2, "0");
  return `${TH_DAYS[p.weekday]} ${p.day} ${TH_MONTHS[p.month - 1]} ${p.year + 543} เวลา ${hh}:${mm}`;
}

export function repeatLabel(repeat: Repeat): string {
  return {
    none: "",
    daily: "ทุกวัน",
    weekdays: "ทุกวันทำงาน (จ.–ศ.)",
    weekly: "ทุกสัปดาห์",
    monthly: "ทุกเดือน",
  }[repeat];
}

/** ปฏิทิน 14 วันข้างหน้า ส่งให้ AI ใช้อ้างอิง จะได้ไม่ต้องคำนวณวันเอง */
export function upcomingCalendar(now: number, days = 14): string {
  const lines: string[] = [];
  for (let i = 0; i < days; i++) {
    const ms = now + i * DAY_MS;
    const p = toLocal(ms);
    const label = i === 0 ? " (วันนี้)" : i === 1 ? " (พรุ่งนี้)" : i === 2 ? " (มะรืน)" : "";
    lines.push(`${isoLocalDate(ms)} วัน${TH_DAYS_FULL[p.weekday]}${label}`);
  }
  return lines.join("\n");
}
