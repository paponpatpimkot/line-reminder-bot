import {
  chatIdOf,
  displayName,
  postbackButton,
  push,
  quota,
  recipientCount,
  reply,
  text,
  verifySignature,
  type Env,
  type LineMessage,
  type Source,
  type WebhookEvent,
} from "./line";
import { parseMessage } from "./parse";
import { formatThai, nextOccurrence, repeatLabel, resolveFireAt, timesPerMonth, toLocal, type Repeat } from "./time";

interface Mention {
  userId?: string;
  name: string;
}

interface ReminderRow {
  id: number;
  chat_id: string;
  chat_type: string;
  text: string;
  mentions: string;
  mention_all: number;
  fire_at: number;
  repeat: Repeat;
  anchor_day: number | null;
  status: string;
  fail_reason: string | null;
}

const HELP = `วิธีใช้บอทเตือนความจำ
• ตั้งเตือน: "เตือน พรุ่งนี้ 9 โมง ประชุมทีม @ชื่อ"
• เตือนซ้ำ: "เตือน ทุกวันศุกร์ บ่าย 3 ส่งรายงาน"
• เตือนทุกคน: "เตือนทุกคน 30 พ.ย. 2 ทุ่ม ปิดระบบ"
• ดูรายการ: "เตือน ดูรายการ"
• ลบ: "เตือน ลบ 12"
• โควตา: "เตือน โควตา"
ในกลุ่ม ให้ขึ้นต้นด้วย "เตือน" หรือ "บอท" หรือแท็กบอท`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET") return new Response("line-reminder-bot ok");
    if (request.method !== "POST" || url.pathname !== "/webhook") return new Response("not found", { status: 404 });

    const body = await request.text();
    const ok = await verifySignature(env.LINE_CHANNEL_SECRET, body, request.headers.get("x-line-signature"));
    if (!ok) return new Response("bad signature", { status: 401 });

    const { events } = JSON.parse(body) as { events: WebhookEvent[] };
    // ตอบ LINE ทันที แล้วค่อยประมวลผลต่อเบื้องหลัง
    ctx.waitUntil(
      Promise.all(
        events.map((e) =>
          handleEvent(env, e).catch((err) => console.error("event failed", err)),
        ),
      ),
    );
    return new Response("ok");
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sendDueReminders(env));
  },
} satisfies ExportedHandler<Env>;

// ======================= รับข้อความ =======================

async function handleEvent(env: Env, event: WebhookEvent): Promise<void> {
  if (!event.replyToken) return;

  if (event.type === "join") {
    await reply(env, event.replyToken, [text(`สวัสดีครับ ผมเป็นบอทเตือนความจำของกลุ่มนี้\n\n${HELP}`)]);
    return;
  }

  if (event.type === "postback" && event.postback) {
    await handlePostback(env, event);
    return;
  }

  if (event.type !== "message" || event.message?.type !== "text" || !event.message.text) return;

  const { addressed, cleaned, mentions, mentionAll } = readMessage(env, event);
  if (!addressed) return;

  const chatId = chatIdOf(event.source);
  const notice = await failureNotice(env, chatId);
  const messages = await respond(env, event.source, cleaned, mentions, mentionAll);
  if (notice) messages.unshift(text(notice));
  await reply(env, event.replyToken, messages);
}

/** แยกการแท็ก และตัดสินว่าข้อความนี้เรียกบอทหรือเปล่า */
function readMessage(env: Env, event: WebhookEvent) {
  const raw = event.message?.text ?? "";
  const mentionees = [...(event.message?.mention?.mentionees ?? [])].sort((a, b) => b.index - a.index);
  let cleaned = raw;
  let addressed = event.source.type === "user";
  let mentionAll = false;
  const mentions: Mention[] = [];

  for (const m of mentionees) {
    const label = raw.slice(m.index, m.index + m.length);
    if (m.isSelf) addressed = true;
    else if (m.type === "all") mentionAll = true;
    else mentions.unshift({ userId: m.userId, name: label.replace(/^@/, "").trim() });
    cleaned = cleaned.slice(0, m.index) + cleaned.slice(m.index + m.length);
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  const keywords = env.BOT_KEYWORDS.split(",").map((k) => k.trim()).filter(Boolean);
  if (keywords.some((k) => cleaned.startsWith(k))) addressed = true;
  if (cleaned.startsWith("บอท")) cleaned = cleaned.slice(3).trim();

  return { addressed, cleaned, mentions, mentionAll };
}

async function respond(env: Env, source: Source, message: string, mentions: Mention[], mentionAll: boolean): Promise<LineMessage[]> {
  const chatId = chatIdOf(source);

  // คำสั่งง่ายๆ ไม่ต้องเรียก AI
  const simple = message.replace(/^เตือน\s*/, "").trim();
  if (/^(วิธีใช้|ช่วยด้วย|help)$/i.test(simple)) return [text(HELP)];
  if (/^(ดู)?รายการ(เตือน)?$/.test(simple)) return [await listReminders(env, chatId)];
  if (/^(โควตา|โควต้า)$/.test(simple)) return [await quotaText(env, source)];
  const del = /^(ลบ|ยกเลิก)\s*#?\s*([\d\s,#]+)$/.exec(simple);
  if (del) return [await deleteReminders(env, chatId, del[2].split(/[\s,#]+/).filter(Boolean).map(Number))];

  const now = Date.now();
  const intent = await parseMessage(env.ANTHROPIC_API_KEY, env.CLAUDE_MODEL, message, now);
  if (!intent) return [text("ขอโทษครับ ตอนนี้ระบบแปลคำสั่งขัดข้อง ลองใหม่อีกครั้งนะครับ")];

  switch (intent.action) {
    case "list":
      return [await listReminders(env, chatId)];
    case "delete":
      return [await deleteReminders(env, chatId, intent.delete_ids)];
    case "quota":
      return [await quotaText(env, source)];
    case "help":
      return [text(HELP)];
    case "create":
      return [await createReminder(env, source, intent, mentions, mentionAll || intent.mention_all, now)];
    default:
      return [text(intent.reply || HELP)];
  }
}

async function createReminder(
  env: Env,
  source: Source,
  intent: { text: string; date: string; time: string; in_minutes: number; repeat: Repeat; reply: string },
  mentions: Mention[],
  mentionAll: boolean,
  now: number,
): Promise<LineMessage> {
  if (!intent.text.trim()) return text(intent.reply || "จะให้เตือนเรื่องอะไรครับ");

  const resolved = resolveFireAt(now, intent.date, intent.time, intent.in_minutes, env.DEFAULT_TIME);
  if (!resolved) return text('ผมไม่แน่ใจเรื่องวันหรือเวลา ลองพิมพ์ใหม่ เช่น "เตือน พรุ่งนี้ 9 โมง ประชุม"');
  if (resolved.fireAt < now - 60_000) {
    return text(`เวลา ${formatThai(resolved.fireAt)} ผ่านไปแล้วครับ ลองบอกวันเวลาใหม่อีกครั้ง`);
  }

  const chatId = chatIdOf(source);
  const anchorDay = intent.repeat === "monthly" ? toLocal(resolved.fireAt).day : null;
  const result = await env.DB.prepare(
    `INSERT INTO reminders (chat_id, chat_type, created_by, text, mentions, mention_all, fire_at, repeat, anchor_day, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(chatId, source.type, source.userId ?? null, intent.text.trim(), JSON.stringify(mentions), mentionAll ? 1 : 0, resolved.fireAt, intent.repeat, anchorDay, now, now)
    .run();
  const id = result.meta.last_row_id;

  const lines = [`✅ ตั้งเตือนแล้ว #${id}`, formatThai(resolved.fireAt), `เรื่อง: ${intent.text.trim()}`];
  if (resolved.usedDefaultTime) lines.push(`(ไม่ได้บอกเวลา จึงตั้งเป็น ${env.DEFAULT_TIME} น.)`);
  if (intent.repeat !== "none") lines.push(`ซ้ำ: ${repeatLabel(intent.repeat)}`);
  if (mentionAll) lines.push("แท็ก: ทุกคน");
  else if (mentions.length) lines.push(`แท็ก: ${mentions.map((m) => "@" + m.name).join(" ")}`);

  // ประมาณการใช้โควตา
  const recipients = await recipientCount(env, source.type, chatId);
  const q = await quota(env).catch(() => null);
  if (q?.limit) {
    const perMonth = Math.ceil(timesPerMonth(intent.repeat) * recipients);
    const left = Math.max(q.limit - q.used, 0);
    lines.push(`ใช้โควตา ${intent.repeat === "none" ? perMonth : `ราว ${perMonth}/เดือน`} จากที่เหลือ ${left} ข้อความ`);
    if (perMonth > left) lines.push("⚠️ โควตาเดือนนี้อาจไม่พอ การเตือนบางครั้งจะส่งไม่ออก");
  }

  return text(lines.join("\n"), [postbackButton(`ยกเลิก #${id}`, `a=cancel&id=${id}`, `ยกเลิกเตือน #${id}`)]);
}

async function listReminders(env: Env, chatId: string): Promise<LineMessage> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM reminders WHERE chat_id = ? AND status = 'active' ORDER BY fire_at LIMIT 20`,
  )
    .bind(chatId)
    .all<ReminderRow>();
  if (!results.length) return text("ยังไม่มีการเตือนที่รออยู่ครับ");
  const lines = results.map((r) => {
    const rep = r.repeat !== "none" ? ` (${repeatLabel(r.repeat)})` : "";
    return `#${r.id} ${formatThai(r.fire_at)}\n   ${r.text}${rep}`;
  });
  return text(`การเตือนที่รออยู่ ${results.length} รายการ\n\n${lines.join("\n")}\n\nลบได้ด้วย "เตือน ลบ <หมายเลข>"`);
}

async function deleteReminders(env: Env, chatId: string, ids: number[]): Promise<LineMessage> {
  const valid = ids.filter((n) => Number.isInteger(n) && n > 0);
  if (!valid.length) return text('บอกหมายเลขที่จะลบด้วยครับ เช่น "เตือน ลบ 12" (ดูหมายเลขได้จาก "เตือน ดูรายการ")');
  const done: number[] = [];
  for (const id of valid) {
    const r = await env.DB.prepare(
      `UPDATE reminders SET status = 'cancelled', updated_at = ? WHERE id = ? AND chat_id = ? AND status = 'active'`,
    )
      .bind(Date.now(), id, chatId)
      .run();
    if (r.meta.changes) done.push(id);
  }
  if (!done.length) return text("ไม่พบการเตือนหมายเลขนั้นในแชทนี้ครับ");
  return text(`🗑️ ยกเลิกแล้ว: ${done.map((n) => "#" + n).join(", ")}`);
}

async function quotaText(env: Env, source: Source): Promise<LineMessage> {
  const [q, recipients] = await Promise.all([quota(env), recipientCount(env, source.type, chatIdOf(source))]);
  if (q.limit === null) return text(`เดือนนี้ใช้ไป ${q.used} ข้อความ (แพ็กเกจนี้ไม่จำกัด)`);
  const left = Math.max(q.limit - q.used, 0);
  return text(
    `โควตาเดือนนี้: ใช้ไป ${q.used} จาก ${q.limit} ข้อความ\n` +
      `แชทนี้มี ${recipients} คน เตือน 1 ครั้งใช้ ${recipients} ข้อความ\n` +
      `เตือนได้อีกราว ${Math.floor(left / recipients)} ครั้ง (รีเซ็ตต้นเดือน)`,
  );
}

async function handlePostback(env: Env, event: WebhookEvent): Promise<void> {
  const params = new URLSearchParams(event.postback?.data ?? "");
  const id = Number(params.get("id"));
  const chatId = chatIdOf(event.source);
  const row = await env.DB.prepare(`SELECT * FROM reminders WHERE id = ? AND chat_id = ?`).bind(id, chatId).first<ReminderRow>();
  if (!row) return;

  if (params.get("a") === "cancel") {
    const r = await env.DB.prepare(`UPDATE reminders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'active'`)
      .bind(Date.now(), id)
      .run();
    await reply(env, event.replyToken!, [text(r.meta.changes ? `🗑️ ยกเลิกเตือน #${id} แล้ว` : `เตือน #${id} ถูกยกเลิกหรือส่งไปแล้ว`)]);
    return;
  }

  if (params.get("a") === "done") {
    if (row.repeat === "none" && row.status === "sent") {
      await env.DB.prepare(`UPDATE reminders SET status = 'done', updated_at = ? WHERE id = ?`).bind(Date.now(), id).run();
    }
    const name = event.source.userId ? await displayName(env, event.source, event.source.userId) : "สมาชิก";
    await reply(env, event.replyToken!, [text(`✅ ${name} ทำ "${row.text}" เสร็จแล้ว`)]);
  }
}

/** ข้อความแจ้งการเตือนที่ส่งไม่ออก แสดงครั้งเดียวในการตอบครั้งถัดไป */
async function failureNotice(env: Env, chatId: string): Promise<string> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM reminders WHERE chat_id = ? AND fail_reason IS NOT NULL AND fail_notified = 0 ORDER BY fire_at LIMIT 10`,
  )
    .bind(chatId)
    .all<ReminderRow>();
  if (!results.length) return "";
  await env.DB.prepare(`UPDATE reminders SET fail_notified = 1 WHERE chat_id = ? AND fail_reason IS NOT NULL AND fail_notified = 0`)
    .bind(chatId)
    .run();
  const lines = results.map((r) => `• #${r.id} ${r.text} (${r.fail_reason})`);
  return `⚠️ มีการเตือนที่ส่งไม่ออก:\n${lines.join("\n")}`;
}

// ======================= ส่งการเตือน (ทุกนาที) =======================

async function sendDueReminders(env: Env): Promise<void> {
  const now = Date.now();

  // งานที่ค้างสถานะ "กำลังส่ง" นานเกิน 10 นาที ถือว่าส่งไม่สำเร็จ
  await env.DB.prepare(
    `UPDATE reminders SET status = 'failed', fail_reason = 'ระบบขัดข้องระหว่างส่ง', fail_notified = 0, updated_at = ?
     WHERE status = 'sending' AND updated_at < ?`,
  )
    .bind(now, now - 10 * 60_000)
    .run();

  const { results: due } = await env.DB.prepare(
    `SELECT * FROM reminders WHERE status = 'active' AND fire_at <= ? ORDER BY fire_at LIMIT 50`,
  )
    .bind(now)
    .all<ReminderRow>();
  if (!due.length) return;

  // จองงานก่อนส่ง กัน cron สองรอบส่งซ้ำ
  const claimed: ReminderRow[] = [];
  for (const r of due) {
    const res = await env.DB.prepare(`UPDATE reminders SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'active'`)
      .bind(now, r.id)
      .run();
    if (res.meta.changes) claimed.push(r);
  }

  const byChat = new Map<string, ReminderRow[]>();
  for (const r of claimed) byChat.set(r.chat_id, [...(byChat.get(r.chat_id) ?? []), r]);

  const q = await quota(env).catch(() => null);
  let used = q?.used ?? 0;

  for (const [chatId, rows] of byChat) {
    const recipients = await recipientCount(env, rows[0].chat_type, chatId);

    if (q?.limit != null && used + recipients > q.limit) {
      await finish(env, rows, now, false, "โควตาข้อความเดือนนี้หมด");
      await logPush(env, chatId, rows, recipients, false, "quota exhausted (skipped)", now);
      continue;
    }

    let lowQuota = "";
    if (q?.limit != null) {
      const leftAfter = q.limit - used - recipients;
      const timesLeft = Math.floor(leftAfter / recipients);
      if (timesLeft < 3) lowQuota = `\n\n⚠️ โควตาเดือนนี้เหลือเตือนแชทนี้ได้อีก ${timesLeft} ครั้ง`;
    }

    const result = await push(env, chatId, [buildReminderMessage(rows, now, lowQuota)]);
    if (result.ok) used += recipients;
    const reason = result.ok ? undefined : result.status === 429 ? "โควตาข้อความเดือนนี้หมด" : `ส่งไม่สำเร็จ (${result.status})`;
    await finish(env, rows, now, result.ok, reason);
    await logPush(env, chatId, rows, recipients, result.ok, result.error ?? null, now);
  }
}

/** รวมทุกการเตือนของแชทเดียวกันเป็นข้อความเดียว (นับโควตาครั้งเดียว) */
function buildReminderMessage(rows: ReminderRow[], now: number, footer: string): LineMessage {
  const substitution: Record<string, unknown> = {};
  let n = 0;
  const tagsFor = (r: ReminderRow): string => {
    if (r.mention_all) {
      substitution.all = { type: "mention", mentionee: { type: "all" } };
      return "{all}";
    }
    const mentions = JSON.parse(r.mentions) as Mention[];
    return mentions
      .map((m) => {
        if (!m.userId) return `@${safe(m.name)}`;
        const key = `m${n++}`;
        substitution[key] = { type: "mention", mentionee: { type: "user", userId: m.userId } };
        return `{${key}}`;
      })
      .join(" ");
  };

  const late = (r: ReminderRow) => (now - r.fire_at > 10 * 60_000 ? " (ล่าช้า)" : "");
  let body: string;
  if (rows.length === 1) {
    const r = rows[0];
    const tags = tagsFor(r);
    body = `⏰ เตือน #${r.id}${late(r)}\n${safe(r.text)}${tags ? `\n${tags}` : ""}`;
  } else {
    body = `⏰ เตือน ${rows.length} เรื่อง\n` + rows.map((r) => `• #${r.id} ${safe(r.text)}${late(r)} ${tagsFor(r)}`.trimEnd()).join("\n");
  }

  const buttons = rows.slice(0, 13).map((r) => postbackButton(rows.length === 1 ? "✅ เสร็จแล้ว" : `✅ เสร็จ #${r.id}`, `a=done&id=${r.id}`));
  const message: LineMessage = { type: "textV2", text: body + footer, quickReply: { items: buttons } };
  if (Object.keys(substitution).length) message.substitution = substitution;
  return message;
}

/** ปีกกาเป็นตัวพิเศษของ textV2 */
function safe(s: string): string {
  return s.replace(/[{}]/g, (c) => (c === "{" ? "(" : ")"));
}

async function finish(env: Env, rows: ReminderRow[], now: number, ok: boolean, reason?: string): Promise<void> {
  for (const r of rows) {
    const next = nextOccurrence(r.fire_at, r.repeat, r.anchor_day, now);
    if (next) {
      // เตือนซ้ำ: ไปต่อรอบหน้าเสมอ ถ้ารอบนี้พลาดก็บันทึกเหตุผลไว้แจ้งภายหลัง
      if (ok) {
        await env.DB.prepare(`UPDATE reminders SET status = 'active', fire_at = ?, updated_at = ? WHERE id = ?`)
          .bind(next, now, r.id)
          .run();
      } else {
        await env.DB.prepare(
          `UPDATE reminders SET status = 'active', fire_at = ?, fail_reason = ?, fail_notified = 0, updated_at = ? WHERE id = ?`,
        )
          .bind(next, reason ?? null, now, r.id)
          .run();
      }
    } else {
      await env.DB.prepare(`UPDATE reminders SET status = ?, fail_reason = ?, fail_notified = 0, updated_at = ? WHERE id = ?`)
        .bind(ok ? "sent" : "failed", ok ? null : reason ?? null, now, r.id)
        .run();
    }
  }
}

async function logPush(env: Env, chatId: string, rows: ReminderRow[], recipients: number, ok: boolean, error: string | null, now: number) {
  await env.DB.prepare(`INSERT INTO push_log (chat_id, reminder_ids, recipients, ok, error, sent_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(chatId, JSON.stringify(rows.map((r) => r.id)), ok ? recipients : 0, ok ? 1 : 0, error, now)
    .run();
}
