// ใช้ Claude แปลงข้อความภาษาไทยเป็นคำสั่งที่โปรแกรมเข้าใจ
// AI แยกแค่ "ส่วนประกอบ" (วันที่ เวลา การทำซ้ำ) ส่วนการคำนวณเวลาจริงทำในโค้ด (time.ts)
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { toLocal, upcomingCalendar } from "./time";

export const Intent = z.object({
  action: z
    .enum(["create", "list", "delete", "quota", "help", "other"])
    .describe("create=ตั้งเตือน, list=ดูรายการ, delete=ลบ/ยกเลิก, quota=ถามโควตา, help=ถามวิธีใช้, other=อย่างอื่น"),
  text: z.string().describe("เรื่องที่ต้องเตือน สั้นๆ ไม่ต้องมีคำบอกเวลาและชื่อคนที่ถูกแท็ก"),
  date: z.string().describe("วันที่แบบ YYYY-MM-DD (ค.ศ.) หรือ \"\" ถ้าไม่ได้บอกวัน"),
  time: z.string().describe("เวลาแบบ HH:MM 24 ชั่วโมง หรือ \"\" ถ้าไม่ได้บอกเวลา"),
  in_minutes: z.number().int().describe("ถ้าบอกเป็นระยะเวลาจากนี้ เช่น อีก 30 นาที = 30, อีก 2 ชั่วโมง = 120 ไม่อย่างนั้น 0"),
  repeat: z.enum(["none", "daily", "weekdays", "weekly", "monthly"]),
  mention_all: z.boolean().describe("true ถ้าบอกให้เตือน/แท็กทุกคน"),
  delete_ids: z.array(z.number().int()).describe("หมายเลขการเตือนที่ต้องการลบ"),
  reply: z.string().describe("สำหรับ action=help/other หรือเมื่อข้อมูลไม่พอ: ข้อความตอบกลับภาษาไทยสั้นๆ สุภาพ ไม่เกิน 2 ประโยค"),
});
export type Intent = z.infer<typeof Intent>;

const SYSTEM = `คุณคือตัวแยกคำสั่งของบอทเตือนความจำในกลุ่ม LINE ของที่ทำงานในประเทศไทย
หน้าที่: อ่านข้อความภาษาไทยแล้วตอบเป็น JSON ตาม schema เท่านั้น

กติกาเวลาแบบไทย (24 ชั่วโมง):
- ตี 1 ถึง ตี 5 = 01:00–05:00
- 6 โมงเช้า = 06:00, 7 โมง/7 โมงเช้า = 07:00 ... 11 โมง = 11:00
- เที่ยง/เที่ยงวัน = 12:00, เที่ยงคืน/สองยาม = 00:00 ของวันถัดไป
- บ่ายโมง/บ่าย 1 = 13:00, บ่าย 2 = 14:00, บ่าย 3 = 15:00
- 4 โมงเย็น = 16:00, 5 โมงเย็น = 17:00, 6 โมงเย็น/หกโมงเย็น = 18:00
- 1 ทุ่ม = 19:00, 2 ทุ่ม = 20:00 ... 5 ทุ่ม = 23:00
- "ครึ่ง" = 30 นาที เช่น 2 ทุ่มครึ่ง = 20:30, บ่าย 3 ครึ่ง = 15:30
- 9.30, 9:30, 09.30 น. = 09:30 ; 8 pm = 20:00
- "โมง" เฉยๆ ที่ไม่มีบริบท เช่น "3 โมง" ให้ตีความเป็นช่วงกลางวันที่สมเหตุสมผล (3 โมง = 15:00, 9 โมง = 09:00)

กติกาวันที่:
- ใช้ตาราง "ปฏิทิน 14 วันข้างหน้า" ที่ให้มาเพื่อหาวันที่ ห้ามเดาวันในสัปดาห์เอง
- "วันศุกร์" หรือ "ศุกร์นี้" = วันศุกร์ที่ใกล้ที่สุดที่ยังไม่ผ่าน, "ศุกร์หน้า" = วันศุกร์ของสัปดาห์ถัดไป
- "สิ้นเดือน" = วันสุดท้ายของเดือนนี้, "ต้นเดือน" = วันที่ 1 ของเดือนหน้า
- ปี พ.ศ. ให้ลบ 543 เป็น ค.ศ.
- ถ้าบอกเวลาแต่ไม่บอกวัน ให้ date = ""

การทำซ้ำ: ทุกวัน=daily, ทุกวันทำงาน/จันทร์ถึงศุกร์=weekdays, ทุกวันจันทร์ (หรือวันใดวันหนึ่งทุกสัปดาห์)=weekly พร้อมใส่ date เป็นครั้งแรกที่จะถึง, ทุกเดือน/ทุกวันที่ 5=monthly พร้อมใส่ date ครั้งแรก

ข้อความที่ขึ้นต้นด้วย "ลบ", "ยกเลิก" ตามด้วยหมายเลข = delete
"ดูรายการ", "มีเตือนอะไรบ้าง" = list ; "โควตา", "เหลือกี่ครั้ง" = quota
ถ้าเป็นการตั้งเตือนแต่ไม่รู้ว่าจะเตือนเรื่องอะไรเลย ให้ action=other และใส่ reply ถามกลับ
ช่องที่ไม่ใช้ ให้ใส่ "" หรือ 0 หรือ [] หรือ false`;

export async function parseMessage(apiKey: string, model: string, message: string, now: number): Promise<Intent | null> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 25_000 });
  const p = toLocal(now);
  const nowText = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;

  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { format: zodOutputFormat(Intent) },
      messages: [
        {
          role: "user",
          content: `เวลาปัจจุบัน (เวลาไทย): ${nowText}\n\nปฏิทิน 14 วันข้างหน้า:\n${upcomingCalendar(now)}\n\nข้อความ:\n${message}`,
        },
      ],
    });
    if (response.stop_reason === "refusal") return null;
    return response.parsed_output ?? null;
  } catch (err) {
    console.error("Claude parse failed", err);
    return null;
  }
}
