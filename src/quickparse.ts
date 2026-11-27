// แยกวันเวลาภาษาไทยแบบใช้กฎ (ไม่เรียก AI) สำหรับรูปแบบที่พบบ่อย
// ถ้าอ่านไม่ออก คืน null แล้วให้ AI ช่วยต่อ
import { daysInMonth, fromLocal, isoLocalDate, toLocal, type Repeat } from "./time";

export interface QuickIntent {
  text: string;
  date: string;
  time: string;
  in_minutes: number;
  repeat: Repeat;
  mention_all: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS: Record<string, number> = {
  อาทิตย์: 0,
  จันทร์: 1,
  อังคาร: 2,
  พุธ: 3,
  พฤหัส: 4,
  พฤหัสบดี: 4,
  ศุกร์: 5,
  เสาร์: 6,
};
const WD = "(จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์|อาทิตย์)";
const MONTHS: [RegExp, number][] = [
  [/^(ม\.ค\.|มกราคม|มกรา)$/, 1],
  [/^(ก\.พ\.|กุมภาพันธ์|กุมภา)$/, 2],
  [/^(มี\.ค\.|มีนาคม|มีนา)$/, 3],
  [/^(เม\.ย\.|เมษายน|เมษา)$/, 4],
  [/^(พ\.ค\.|พฤษภาคม|พฤษภา)$/, 5],
  [/^(มิ\.ย\.|มิถุนายน|มิถุนา)$/, 6],
  [/^(ก\.ค\.|กรกฎาคม|กรกฎา)$/, 7],
  [/^(ส\.ค\.|สิงหาคม|สิงหา)$/, 8],
  [/^(ก\.ย\.|กันยายน|กันยา)$/, 9],
  [/^(ต\.ค\.|ตุลาคม|ตุลา)$/, 10],
  [/^(พ\.ย\.|พฤศจิกายน|พฤศจิกา)$/, 11],
  [/^(ธ\.ค\.|ธันวาคม|ธันวา)$/, 12],
];
const MONTH_WORDS =
  "(ม\\.ค\\.|ก\\.พ\\.|มี\\.ค\\.|เม\\.ย\\.|พ\\.ค\\.|มิ\\.ย\\.|ก\\.ค\\.|ส\\.ค\\.|ก\\.ย\\.|ต\\.ค\\.|พ\\.ย\\.|ธ\\.ค\\.|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|มกรา|กุมภา|มีนา|เมษา|พฤษภา|มิถุนา|กรกฎา|สิงหา|กันยา|ตุลา|พฤศจิกา|ธันวา)";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function normalizeYear(y: number, fallback: number): number {
  if (!y) return fallback;
  if (y < 100) y += y > 50 ? 2500 : 2000; // 69 -> 2569, 26 -> 2026
  if (y > 2400) y -= 543;
  return y;
}

/** วัน (ในสัปดาห์) ที่จะถึง ; nextWeek = "หน้า" */
function nextWeekday(now: number, weekday: number, nextWeek: boolean): string {
  const today = toLocal(now).weekday;
  let diff = (weekday - today + 7) % 7;
  if (nextWeek) diff += diff === 0 ? 7 : 7;
  return isoLocalDate(now + diff * DAY_MS);
}

/** วันที่ D/M ที่จะถึง ถ้าไม่ระบุปีและวันนั้นผ่านไปแล้ว ใช้ปีหน้า */
function dayMonth(now: number, d: number, m: number, y: number): string | null {
  const today = toLocal(now);
  let year = normalizeYear(y, today.year);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(year, m)) return null;
  if (!y && fromLocal(year, m, d, 23, 59) < now) year += 1;
  return `${year}-${pad(m)}-${pad(d)}`;
}

export function quickParse(input: string, now: number): QuickIntent | null {
  let s = ` ${input.replace(/\s+/g, " ").trim()} `;
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(s);
    if (m) s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
    return m;
  };

  // คำถามหรือคุยเล่น เช่น "วันนี้กินอะไรดี" ให้ AI ตัดสิน
  if (/อะไร|ไหม|มั้ย|ยังไง|อย่างไร|ทำไม|เหรอ|หรอ|ไง|กี่|ใคร|ที่ไหน|[?？]/.test(input)) return null;

  let mentionAll = false;
  if (take(/^\s*(?:ให้)?ทุกคน(?:ให้)?/)) mentionAll = true;

  // ----- เว้นเสาร์อาทิตย์ -----
  const weekendOff = !!take(
    /(?:ยกเว้น|เว้น|ไม่รวม)\s*(?:วัน)?เสาร์\s*(?:และ|กับ|[-–,]|ถึง)?\s*(?:วัน)?อาทิตย์(?:\s*ไม่ต้องเตือน)?|(?:ยกเว้น|เว้น|ไม่รวม)\s*วันหยุด(?:สุดสัปดาห์|เสาร์\s*-?\s*อาทิตย์)?(?:\s*ไม่ต้องเตือน)?|(?:วัน)?เสาร์\s*(?:และ|กับ|[-–])?\s*(?:วัน)?อาทิตย์\s*ไม่ต้องเตือน/,
  );
  // ข้อยกเว้นแบบอื่น ให้ AI อ่าน
  if (/ยกเว้น|เว้น|ไม่ต้องเตือน/.test(s)) return null;

  // ----- เตือนซ้ำ -----
  let repeat: Repeat = "none";
  let date = "";
  let m: RegExpExecArray | null;
  if (take(/(?:ทุก(?:ๆ)?\s*)?วันทำงาน|(?:ทุก(?:ๆ)?\s*)?(?:วัน)?จันทร์\s*(?:ถึง|-|–)\s*(?:วัน)?ศุกร์/)) repeat = "weekdays";
  else if ((m = take(new RegExp(`ทุก(?:วัน)?${WD}`)))) {
    repeat = "weekly";
    date = nextWeekday(now, WEEKDAYS[m[1]], false);
  } else if ((m = take(/ทุก(?:ๆ)?\s*วันที่\s*(\d{1,2})(?:\s*ของเดือน)?/))) {
    repeat = "monthly";
    const day = Number(m[1]);
    if (day < 1 || day > 31) return null;
    const t = toLocal(now);
    let [y, mo] = [t.year, t.month];
    if (fromLocal(y, mo, Math.min(day, daysInMonth(y, mo)), 23, 59) < now) [y, mo] = mo === 12 ? [y + 1, 1] : [y, mo + 1];
    date = `${y}-${pad(mo)}-${pad(Math.min(day, daysInMonth(y, mo)))}`;
  } else if (take(/ทุก(?:ๆ)?\s*เดือน/)) repeat = "monthly";
  else if (take(/ทุก(?:ๆ)?\s*(?:สัปดาห์|อาทิตย์)/)) repeat = "weekly";
  else if (take(/ทุก(?:ๆ)?\s*วัน/)) repeat = "daily";

  // ----- อีก N นาที/ชั่วโมง -----
  let inMinutes = 0;
  if ((m = take(/อีก\s*(\d+)\s*(นาที|ชั่วโมง|ชม\.?)\s*(ครึ่ง)?/))) {
    inMinutes = Number(m[1]) * (m[2] === "นาที" ? 1 : 60) + (m[3] ? 30 : 0);
  } else if (take(/อีกครึ่ง\s*ชั่วโมง/)) inMinutes = 30;
  else if (take(/อีก\s*(?:1\s*)?ชั่วโมง/)) inMinutes = 60;

  // ----- วันที่ -----
  if (!date) {
    if ((m = take(/(?:วันที่\s*)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/))) {
      const d = dayMonth(now, Number(m[1]), Number(m[2]), Number(m[3] ?? 0));
      if (!d) return null;
      date = d;
    } else if (take(/วันนี้|คืนนี้|เย็นนี้|บ่ายนี้/)) date = isoLocalDate(now);
    else if (take(/มะรืน(?:นี้)?/)) date = isoLocalDate(now + 2 * DAY_MS);
    else if (take(/พรุ่งนี้/)) date = isoLocalDate(now + DAY_MS);
    else if ((m = take(new RegExp(`(?:วันที่\\s*)?(\\d{1,2})\\s*${MONTH_WORDS}\\s*(\\d{2,4})?`)))) {
      const month = MONTHS.find(([re]) => re.test(m![2]))?.[1] ?? 0;
      const d = dayMonth(now, Number(m[1]), month, Number(m[3] ?? 0));
      if (!d) return null;
      date = d;
    } else if ((m = take(new RegExp(`(?:วัน)?${WD}\\s*(นี้|หน้า)`))) || (m = take(new RegExp(`วัน${WD}`)))) {
      date = nextWeekday(now, WEEKDAYS[m[1]], m[2] === "หน้า");
    }
  }

  // ----- เวลา -----
  let time = "";
  const half = (x?: string) => (x ? 30 : 0);
  if ((m = take(/(\d{1,2})[:.](\d{2})\s*(?:น\.|นาฬิกา)?/))) {
    if (Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    time = `${pad(Number(m[1]))}:${m[2]}`;
  } else if ((m = take(/ตี\s*(\d)\s*(ครึ่ง)?/))) time = `${pad(Number(m[1]))}:${pad(half(m[2]))}`;
  else if (take(/เที่ยงคืน|สองยาม/)) time = "00:00";
  else if ((m = take(/เที่ยง(?:วัน)?\s*(ครึ่ง)?/))) time = `12:${pad(half(m[1]))}`;
  else if ((m = take(/บ่าย\s*(\d{1,2}|โมง)\s*(?:โมง)?\s*(ครึ่ง)?/))) {
    const h = m[1] === "โมง" ? 1 : Number(m[1]);
    if (h < 1 || h > 5) return null;
    time = `${12 + h}:${pad(half(m[2]))}`;
  } else if ((m = take(/(\d{1,2})\s*ทุ่ม\s*(ครึ่ง)?/))) {
    const h = Number(m[1]);
    if (h < 1 || h > 5) return null;
    time = `${18 + h}:${pad(half(m[2]))}`;
  } else if ((m = take(/(\d{1,2})\s*โมง\s*เย็น\s*(ครึ่ง)?/))) {
    const h = Number(m[1]);
    time = `${h <= 6 ? 12 + h : h}:${pad(half(m[2]))}`;
  } else if ((m = take(/(\d{1,2})\s*โมง\s*(เช้า)?\s*(ครึ่ง)?/))) {
    let h = Number(m[1]);
    if (h > 12) return null;
    if (!m[2] && h >= 1 && h <= 5) h += 12; // "3 โมง" = บ่าย 3
    time = `${pad(h)}:${pad(half(m[3]))}`;
  }

  if (weekendOff) {
    if (repeat === "daily") repeat = "weekdays";
    else if (repeat !== "weekdays") return null;
  }

  // ต้องมีเวลาชัดเจน ไม่งั้นอาจเป็นแค่ประโยคที่มีคำว่า "วันนี้" "พรุ่งนี้" ให้ AI ตัดสิน
  if (!time && !inMinutes) return null;

  // ส่วนที่เหลือคือเรื่องที่ต้องเตือน
  let text = s
    .replace(/(^|\s)(ตอน|เวลา|วันที่|เรื่อง|ให้|ด้วย|นะ|น\.|ช่วย)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-:,]\s*/, "");
  // คำเชื่อมที่ติดท้ายหรือหัวเรื่องโดยไม่มีช่องว่าง เช่น "ส่งงานตอน"
  text = text.replace(/(ตอน|เวลา|ภายใน|ก่อน)$/, "").replace(/^(ให้|เรื่อง)/, "").trim();
  if (!text) return null;

  return { text, date, time, in_minutes: inMinutes, repeat, mention_all: mentionAll };
}
