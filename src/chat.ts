// โหมดคุยเล่นกับป้า: ข้อความที่ไม่ใช่คำสั่งเตือน ให้ AI ตอบแบบป้าใจดี
// จำบทสนทนาล่าสุดของแต่ละแชทไว้ในตาราง chat_history
import Anthropic from "@anthropic-ai/sdk";
import type { ParseEnv } from "./parse";
import { toLocal } from "./time";

export interface ChatEnv extends ParseEnv {
  DB: D1Database;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

const HISTORY_TURNS = 6; // จำ 6 ข้อความล่าสุด (คนพูด 3 ป้าตอบ 3)
const HISTORY_MAX_AGE = 6 * 60 * 60 * 1000; // ลืมเรื่องที่คุยไว้นานเกิน 6 ชั่วโมง

const PERSONA = `คุณคือ "ป้า" ผู้หญิงวัยกลางคนใจดี อารมณ์ดี อยู่ในกลุ่ม LINE ของที่ทำงานในประเทศไทย
- แทนตัวเองว่า "ป้า" เรียกคนที่คุยด้วยว่า "หลาน" (หรือ "หลาน" ตามด้วยชื่อ)
- ลงท้ายด้วย จ้ะ จ๊ะ นะจ๊ะ จ้า ห้ามใช้ ครับ ผม ค่ะ ดิฉัน
- ตอบภาษาไทย สั้นๆ เป็นกันเอง 1–3 ประโยค เหมือนแชท ไม่ใช้หัวข้อหรือ markdown
- เรื่องสุขภาพ กฎหมาย การเงิน ให้คำแนะนำทั่วไปอย่างระวัง และแนะนำให้ถามผู้เชี่ยวชาญ
- เรื่องที่เปลี่ยนตามเวลา (ข่าว ผู้นำประเทศ ราคา อากาศ) ให้ค้น Google ก่อนตอบถ้าทำได้ และตอบตามที่ค้นเจอ
- ถ้าไม่รู้ให้บอกตรงๆ ห้ามแต่งข้อมูล
- ป้ามีอีกหน้าที่คือช่วยเตือนความจำ ถ้าหลานดูเหมือนอยากให้เตือน บอกวิธี เช่น "เตือน พรุ่งนี้ 9 โมง ประชุม"`;

type Turn = { role: "user" | "assistant"; content: string };

const ENSURE_TABLE = `CREATE TABLE IF NOT EXISTS chat_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    TEXT    NOT NULL,
  role       TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
)`;

/** ตารางนี้เพิ่มทีหลัง สร้างให้อัตโนมัติถ้ายังไม่มี จะได้ไม่ต้องรันคำสั่งฐานข้อมูลเพิ่ม */
async function ensureTable(db: D1Database): Promise<void> {
  await db.prepare(ENSURE_TABLE).run();
}

async function loadHistory(db: D1Database, chatId: string, now: number): Promise<Turn[]> {
  const { results } = await db
    .prepare(`SELECT role, content FROM chat_history WHERE chat_id = ? AND created_at > ? ORDER BY id DESC LIMIT ?`)
    .bind(chatId, now - HISTORY_MAX_AGE, HISTORY_TURNS)
    .all<Turn>();
  const turns = results.reverse();
  // ประวัติต้องเริ่มด้วยข้อความของคน
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

async function saveTurns(db: D1Database, chatId: string, turns: Turn[], now: number): Promise<void> {
  const insert = db.prepare(`INSERT INTO chat_history (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)`);
  await db.batch([
    ...turns.map((t, i) => insert.bind(chatId, t.role, t.content, now + i)),
    // เก็บไว้ไม่เกิน 20 ข้อความต่อแชท
    db
      .prepare(
        `DELETE FROM chat_history WHERE chat_id = ? AND id NOT IN (SELECT id FROM chat_history WHERE chat_id = ? ORDER BY id DESC LIMIT 20)`,
      )
      .bind(chatId, chatId),
  ]);
}

function systemPrompt(now: number): string {
  const p = toLocal(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${PERSONA}\n\nตอนนี้เวลาไทย ${p.year + 543}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)} (พ.ศ.)`;
}

/** คุยกับป้า คืนข้อความตอบ หรือ null ถ้า AI ใช้ไม่ได้ */
/** ล้างบทสนทนาที่ป้าจำไว้ในแชทนี้ */
export async function forgetChat(db: D1Database, chatId: string): Promise<void> {
  await ensureTable(db);
  await db.prepare(`DELETE FROM chat_history WHERE chat_id = ?`).bind(chatId).run();
}

export async function chatWithAuntie(env: ChatEnv, chatId: string, speaker: string | null, message: string, now: number): Promise<string | null> {
  try {
    await ensureTable(env.DB);
    const history = await loadHistory(env.DB, chatId, now);
    const userTurn: Turn = { role: "user", content: speaker ? `${speaker}: ${message}` : message };
    const turns = [...history, userTurn];

    const answer = await ask(env, now, turns);
    if (!answer) return null;

    await saveTurns(env.DB, chatId, [userTurn, { role: "assistant", content: answer }], now);
    return answer;
  } catch (err) {
    console.error("chat failed", err);
    return null;
  }
}

/** เลือก AI สำหรับคุยเล่น: Claude ถ้าตั้งไว้, Gemini ถ้ามี key, ไม่งั้น Workers AI ; Gemini ใช้ไม่ได้ (เช่นโควตาวันนี้หมด) ถอยไปใช้ Workers AI */
async function ask(env: ChatEnv, now: number, turns: Turn[]): Promise<string | null> {
  if (env.AI_PROVIDER === "claude") return askClaude(env, now, turns);
  if (env.GEMINI_API_KEY) {
    // ลองแบบค้น Google ก่อน ถ้าใช้ไม่ได้ (เช่นโควตาค้นหาหมด) ลองแบบไม่ค้น
    for (const search of [true, false]) {
      const answer = await askGemini(env, now, turns, search).catch((err) => {
        console.error(`Gemini chat failed (search=${search})`, err);
        return null;
      });
      if (answer) return answer;
    }
  }
  return askWorkersAI(env, now, turns);
}

async function askGemini(env: ChatEnv, now: number, turns: Turn[], search: boolean): Promise<string | null> {
  const model = env.GEMINI_MODEL || "gemini-flash-lite-latest";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(now) }] },
      contents: turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
      generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
      // ให้ Gemini ค้น Google เองเมื่อคำถามต้องใช้ข้อมูลปัจจุบัน
      ...(search ? { tools: [{ google_search: {} }] } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const out = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return cleanAnswer(out);
}

async function askWorkersAI(env: ChatEnv, now: number, turns: Turn[]): Promise<string | null> {
  if (!env.AI) return null;
  const model = (env.WORKERS_AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast") as Parameters<Ai["run"]>[0];
  const result = (await env.AI.run(model, {
    messages: [{ role: "system", content: systemPrompt(now) }, ...turns],
    max_tokens: 300,
    temperature: 0.7,
  } as never)) as { response?: unknown };
  return cleanAnswer(typeof result.response === "string" ? result.response : "");
}

async function askClaude(env: ChatEnv, now: number, turns: Turn[]): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25_000 });
  const response = await client.messages.create({
    model: env.CLAUDE_MODEL || "claude-haiku-5-5",
    max_tokens: 1000,
    system: systemPrompt(now),
    messages: turns,
  });
  const out = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return cleanAnswer(out);
}

/** ตัดคำสุภาพแบบผู้ชายที่โมเดลอาจหลุดมา และจำกัดความยาวให้พอดีแชท */
export function cleanAnswer(raw: string): string | null {
  let s = raw.trim().replace(/^ป้า\s*[:：]\s*/, "");
  s = s.replace(/ครับ/g, "จ้ะ").replace(/(^|\s)ผม(?=\s|$)/g, "$1ป้า");
  if (s.length > 1000) s = s.slice(0, 1000).replace(/\s+\S*$/, "") + "…";
  return s || null;
}

/**
 * ถ้าข้อความขึ้นต้นด้วยคำเรียกบอท (เช่น "ป้า", "บอท") ให้ตัดออก
 * "เตือน" ไม่ตัด เพราะเป็นส่วนหนึ่งของคำสั่ง ; "ป้าย..." ไม่นับเป็นการเรียกป้า
 */
export function matchKeyword(message: string, keywords: string[]): { addressed: boolean; rest: string } {
  for (const k of keywords) {
    if (!message.startsWith(k)) continue;
    if (k === "ป้า" && message.startsWith("ป้าย")) continue;
    const rest =
      k === "เตือน"
        ? message
        : message
            .slice(k.length)
            .replace(/^\s*(จ๋า|จ้า|ครับ|ค่ะ|คะ)/, "")
            .replace(/^[\s,:!]+/, "")
            .trim();
    return { addressed: true, rest };
  }
  return { addressed: false, rest: message };
}
