// ตัวช่วยเรียก LINE Messaging API
const API = "https://api.line.me/v2/bot";

export interface Env {
  DB: D1Database;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  CLAUDE_MODEL: string;
  BOT_KEYWORDS: string;
  DEFAULT_TIME: string;
}

// ---------- ชนิดข้อมูลของ webhook (เฉพาะส่วนที่ใช้) ----------
export interface Source {
  type: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface Mentionee {
  index: number;
  length: number;
  type: "user" | "all";
  userId?: string;
  isSelf?: boolean;
}

export interface WebhookEvent {
  type: string;
  replyToken?: string;
  source: Source;
  timestamp: number;
  message?: { type: string; text?: string; mention?: { mentionees: Mentionee[] } };
  postback?: { data: string };
}

export function chatIdOf(source: Source): string {
  return source.groupId ?? source.roomId ?? source.userId ?? "";
}

// ---------- ลายเซ็น webhook ----------
export async function verifySignature(secret: string, body: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- เรียก API ----------
async function call(env: Env, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

export type LineMessage = Record<string, unknown>;

/** ตอบกลับ (Reply) ไม่นับโควตา ใช้ได้ครั้งเดียวภายในราว 1 นาทีหลังได้ event */
export async function reply(env: Env, replyToken: string, messages: LineMessage[]): Promise<void> {
  const res = await call(env, "POST", "/message/reply", { replyToken, messages: messages.slice(0, 5) });
  if (!res.ok) console.error("reply failed", res.status, await res.text());
}

/** ส่งเอง (Push) นับโควตาตามจำนวนผู้รับ */
export async function push(env: Env, to: string, messages: LineMessage[]): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await call(env, "POST", "/message/push", { to, messages: messages.slice(0, 5) }, {
    "X-Line-Retry-Key": crypto.randomUUID(),
  });
  if (res.ok) return { ok: true, status: res.status };
  return { ok: false, status: res.status, error: await res.text() };
}

/** จำนวนคนที่ LINE จะนับเมื่อ Push เข้าแชทนี้ */
export async function recipientCount(env: Env, chatType: string, chatId: string): Promise<number> {
  if (chatType === "user") return 1;
  const path = chatType === "group" ? `/group/${chatId}/members/count` : `/room/${chatId}/members/count`;
  const res = await call(env, "GET", path);
  if (!res.ok) return 1;
  const data = (await res.json()) as { count?: number };
  return data.count ?? 1;
}

/** โควตา Push ของเดือนนี้: limit = null แปลว่าไม่จำกัด (แพ็กเกจเสียเงินที่ซื้อเพิ่มได้) */
export async function quota(env: Env): Promise<{ limit: number | null; used: number }> {
  const [q, c] = await Promise.all([call(env, "GET", "/message/quota"), call(env, "GET", "/message/quota/consumption")]);
  const qd = (await q.json()) as { type?: string; value?: number };
  const cd = (await c.json()) as { totalUsage?: number };
  return { limit: qd.type === "limited" ? (qd.value ?? 0) : null, used: cd.totalUsage ?? 0 };
}

export async function displayName(env: Env, source: Source, userId: string): Promise<string> {
  let path = `/profile/${userId}`;
  if (source.type === "group" && source.groupId) path = `/group/${source.groupId}/member/${userId}`;
  if (source.type === "room" && source.roomId) path = `/room/${source.roomId}/member/${userId}`;
  const res = await call(env, "GET", path);
  if (!res.ok) return "สมาชิก";
  const data = (await res.json()) as { displayName?: string };
  return data.displayName ?? "สมาชิก";
}

export function text(t: string, quickReply?: LineMessage[]): LineMessage {
  return quickReply?.length ? { type: "text", text: t, quickReply: { items: quickReply } } : { type: "text", text: t };
}

export function postbackButton(label: string, data: string, displayText?: string): LineMessage {
  return { type: "action", action: { type: "postback", label: label.slice(0, 20), data, ...(displayText ? { displayText } : {}) } };
}
