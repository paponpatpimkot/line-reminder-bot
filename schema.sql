-- ตารางการเตือน
CREATE TABLE IF NOT EXISTS reminders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id       TEXT    NOT NULL,              -- groupId / roomId / userId ปลายทาง
  chat_type     TEXT    NOT NULL,              -- group | room | user
  created_by    TEXT,                          -- userId คนสั่ง
  text          TEXT    NOT NULL,              -- เรื่องที่ต้องเตือน
  mentions      TEXT    NOT NULL DEFAULT '[]', -- JSON [{ "userId": "...", "name": "..." }]
  mention_all   INTEGER NOT NULL DEFAULT 0,    -- 1 = แท็กทุกคน
  fire_at       INTEGER NOT NULL,              -- เวลาเตือนครั้งถัดไป (unix ms, UTC)
  repeat        TEXT    NOT NULL DEFAULT 'none', -- none | daily | weekdays | weekly | monthly
  anchor_day    INTEGER,                       -- วันที่ของเดือน สำหรับเตือนรายเดือน
  status        TEXT    NOT NULL DEFAULT 'active', -- active | sending | sent | done | cancelled | failed
  fail_reason   TEXT,
  fail_notified INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_due  ON reminders (status, fire_at);
CREATE INDEX IF NOT EXISTS idx_reminders_chat ON reminders (chat_id, status);

-- บันทึกการส่ง Push ทุกครั้ง ใช้ตรวจย้อนหลัง
CREATE TABLE IF NOT EXISTS push_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     TEXT    NOT NULL,
  reminder_ids TEXT   NOT NULL,                -- JSON [id, ...]
  recipients  INTEGER NOT NULL,                -- จำนวนข้อความที่ LINE นับ (= สมาชิกในกลุ่ม)
  ok          INTEGER NOT NULL,
  error       TEXT,
  sent_at     INTEGER NOT NULL
);

-- ประวัติคุยเล่นกับป้า (โค้ดสร้างให้เองถ้ายังไม่มี)
CREATE TABLE IF NOT EXISTS chat_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    TEXT    NOT NULL,
  role       TEXT    NOT NULL,                 -- user | assistant
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
