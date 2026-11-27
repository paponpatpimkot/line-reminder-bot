# line-reminder-bot

บอทเตือนความจำบน LINE สำหรับกลุ่มที่ทำงาน พิมพ์ภาษาไทยปกติ แล้วบอทเตือนตรงเวลาพร้อมแท็กคนที่เกี่ยวข้อง

ทำงานบน Cloudflare Workers + D1 + Workers AI ฟรีทั้งหมด ข้อความที่มีรูปแบบวันเวลาชัดเจนบอทอ่านเองโดยไม่ใช้ AI ส่วนภาษาพูดที่ซับซ้อนใช้ Workers AI ช่วย (เปลี่ยนเป็น Claude ได้ถ้าอยากให้แม่นขึ้น)

## ใช้งานในกลุ่ม

บอทพูดแบบ "ป้า" ในกลุ่มจะตอบเฉพาะข้อความที่ขึ้นต้นด้วย `ป้า` `เตือน` หรือ `บอท` หรือแท็กบอท (แชทส่วนตัวตอบทุกข้อความ)

| พิมพ์ | ผล |
| --- | --- |
| `เตือน พรุ่งนี้ 9 โมง ประชุมทีม @สมชาย` | เตือนครั้งเดียว แท็กสมชาย |
| `เตือน ทุกวันศุกร์ บ่าย 3 ส่งรายงาน` | เตือนซ้ำทุกสัปดาห์ |
| `เตือนทุกคน 30 พ.ย. 2 ทุ่ม ปิดระบบ` | แท็กทุกคน |
| `เตือน อีก 30 นาที โทรหาลูกค้า` | นับจากตอนนี้ |
| `เตือน ดูรายการ` | ดูการเตือนที่รออยู่ |
| `เตือน ลบ 12` | ยกเลิกการเตือน #12 |
| `เตือน โควตา` | ดูโควตาข้อความเดือนนี้ |
| `ป้า วันนี้กินอะไรดี` | คุยเล่นกับป้า (ป้าจำที่คุยล่าสุดได้ไม่กี่ข้อความ) |

ตอนเตือนจะมีปุ่ม "✅ เสร็จแล้ว" ให้กด บอทจะตอบว่าใครทำเสร็จ

### เรื่องโควตาฟรี

LINE แพ็กเกจฟรีส่งได้ 300 ข้อความต่อเดือน และการเตือนเข้ากลุ่มนับตามจำนวนสมาชิก
กลุ่ม 20 คน จึงเตือนเข้ากลุ่มได้ราว **15 ครั้งต่อเดือน** ส่วนการที่บอทตอบเมื่อมีคนพิมพ์หรือกดปุ่ม ไม่นับโควตา

บอทช่วยคุมโควตาให้:
- ตอนตั้งเตือน บอกว่าใช้โควตาเท่าไร และเตือนถ้าไม่พอ
- เตือนหลายเรื่องที่ถึงเวลาเดียวกัน รวมเป็นข้อความเดียว
- เมื่อเหลือเตือนได้น้อยกว่า 3 ครั้ง จะบอกท้ายข้อความเตือน
- ถ้าโควตาหมด LINE แค่ไม่ส่ง (ไม่มีค่าใช้จ่าย) บอทจะบอกในกลุ่มครั้งถัดไปที่มีคนพิมพ์หาว่าเตือนไหนส่งไม่ออก

---

## ติดตั้งครั้งแรก (ทำครั้งเดียว ราว 30 นาที)

ต้องมี: Node.js 22.12 ขึ้นไป (เช็กด้วย `node -v`), บัญชี Cloudflare, LINE Official Account ที่เปิด Messaging API แล้ว

บน Windows ถ้า PowerShell ขึ้นว่า "running scripts is disabled" ให้ใช้ `npm.cmd` และ `npx.cmd` แทน `npm` และ `npx`

### 1. ดาวน์โหลดโค้ดและติดตั้ง

```bash
git clone https://github.com/paponpatpimkot/line-reminder-bot.git
cd line-reminder-bot
npm install
npx wrangler login
```

`wrangler login` จะเปิดเบราว์เซอร์ให้ล็อกอิน Cloudflare

### 2. สร้างฐานข้อมูล

```bash
npx wrangler d1 create line-reminder-db
```

คัดลอกค่า `database_id` ที่ได้ ไปใส่แทน `REPLACE_WITH_YOUR_DATABASE_ID` ในไฟล์ `wrangler.toml` แล้วสร้างตาราง:

```bash
npm run db:init
```

### 3. ใส่ความลับ (ห้ามเขียนลงไฟล์หรือส่งในแชท)

```bash
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
```

แต่ละคำสั่งจะให้วางค่าแล้วกด Enter

- `LINE_CHANNEL_SECRET`: LINE Developers Console → channel ของบอท → แท็บ Basic settings
- `LINE_CHANNEL_ACCESS_TOKEN`: แท็บ Messaging API → Channel access token (long-lived) → Issue

### 4. Deploy

```bash
npm run deploy
```

จะได้ URL แบบ `https://line-reminder-bot.<ชื่อของคุณ>.workers.dev` เปิดในเบราว์เซอร์ต้องเห็นคำว่า `line-reminder-bot ok`

### 5. ต่อกับ LINE

ใน LINE Developers Console → แท็บ Messaging API:

1. Webhook URL ใส่ `https://line-reminder-bot.<ชื่อของคุณ>.workers.dev/webhook` (มี `/webhook` ต่อท้าย)
2. กด Verify ต้องขึ้น Success
3. เปิด Use webhook

ใน [LINE Official Account Manager](https://manager.line.biz/) → ตั้งค่า → การตั้งค่าการตอบกลับ:

- ปิด ข้อความตอบกลับอัตโนมัติ และ ข้อความทักทาย
- เปิด Webhook
- ตั้งค่าบัญชี → เปิด "อนุญาตให้บัญชีเข้าร่วมแชทกลุ่ม"

### 6. ทดสอบ

1. แอดบอทเป็นเพื่อน แล้วพิมพ์ในแชทส่วนตัว `อีก 2 นาที ทดสอบ`
2. ถ้าเตือนมาจริง สร้างกลุ่มทดลอง 2–3 คน เชิญบอทเข้า แล้วลองแท็กคน
3. ใช้ได้ดีแล้ว ค่อยเชิญบอทเข้ากลุ่มที่ทำงานจริง

ดู log ตอนมีปัญหา: `npx wrangler tail`

---

## ปรับแต่ง

ค่าใน `[vars]` ของ `wrangler.toml` (แก้แล้ว `npm run deploy` ใหม่):

| ค่า | ค่าเริ่มต้น | ความหมาย |
| --- | --- | --- |
| `AI_PROVIDER` | `workers-ai` | AI ที่ใช้กับภาษาพูด: `workers-ai` (ฟรี) หรือ `claude` (แม่นกว่า ต้องเติมเครดิตและ `npx wrangler secret put ANTHROPIC_API_KEY`) |
| `WORKERS_AI_MODEL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | โมเดลของ Workers AI |
| `CLAUDE_MODEL` | `claude-haiku-5-5` | โมเดล Claude เมื่อเลือก `claude` (ไม่ถึง ฿0.05 ต่อข้อความ) |
| `GEMINI_MODEL` | `gemini-flash-lite-latest` | โมเดล Gemini ที่ใช้คุยเล่น เมื่อใส่ `GEMINI_API_KEY` แล้ว |
| `BOT_KEYWORDS` | `บอท,เตือน` | คำขึ้นต้นที่ทำให้บอทตอบในกลุ่ม (คำว่า `ป้า` ใช้ได้เสมอ) |
| `DEFAULT_TIME` | `08:00` | เวลาที่ใช้เมื่อไม่ได้บอกเวลา |

### ให้ป้าคุยเล่นเก่งขึ้นด้วย Gemini (ฟรี)

1. เข้า https://aistudio.google.com → Get API key → Create API key (ไม่ต้องใส่บัตร)
2. `npx wrangler secret put GEMINI_API_KEY` แล้ววาง key
3. ไม่ต้อง deploy ใหม่ ป้าใช้ Gemini คุยเล่นทันที

ใช้เฉพาะตอนคุยเล่น (Flash-Lite ฟรีราว 500 ข้อความ/วัน) ถ้าโควตาหมด ป้าถอยไปใช้ Workers AI เอง
แบบฟรี Google อาจนำข้อความไปพัฒนาโมเดล อย่าคุยเรื่องลับกับป้า

## โครงสร้างโค้ด

| ไฟล์ | หน้าที่ |
| --- | --- |
| `src/index.ts` | รับ webhook, คำสั่งต่างๆ, ตัวส่งเตือนที่ทำงานทุกนาที |
| `src/quickparse.ts` | อ่านวันเวลาภาษาไทยแบบใช้กฎ (27/11, พรุ่งนี้, 2 ทุ่ม, บ่าย 3, ทุกวันศุกร์ ฯลฯ) |
| `src/chat.ts` | โหมดคุยเล่นกับป้า และประวัติการคุย |
| `src/parse.ts` | ส่งข้อความที่อ่านเองไม่ออกให้ AI แยกเป็น JSON |
| `src/time.ts` | คำนวณเวลาไทยและรอบถัดไปของการเตือนซ้ำ |
| `src/line.ts` | เรียก LINE Messaging API และตรวจลายเซ็น webhook |
| `schema.sql` | ตารางในฐานข้อมูล D1 |

พัฒนาต่อ: `npm test` (ทดสอบการคำนวณเวลาและการอ่านภาษาไทย), `npm run typecheck`
