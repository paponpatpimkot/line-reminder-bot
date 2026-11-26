import { describe, expect, it } from "vitest";
import { cleanAnswer, matchKeyword } from "../src/chat";

const KW = ["บอท", "เตือน", "ป้า"];

describe("matchKeyword", () => {
  it.each([
    ["ป้า วันนี้กินอะไรดี", true, "วันนี้กินอะไรดี"],
    ["ป้าจ๋า เหนื่อยจัง", true, "เหนื่อยจัง"],
    ["ป้าครับ สบายดีไหม", true, "สบายดีไหม"],
    ["ป้า, ช่วยหน่อย", true, "ช่วยหน่อย"],
    ["บอท ดูรายการ", true, "ดูรายการ"],
    ["เตือน พรุ่งนี้ 9 โมง ประชุม", true, "เตือน พรุ่งนี้ 9 โมง ประชุม"],
    ["ป้ายรถเมล์อยู่ไหน", false, "ป้ายรถเมล์อยู่ไหน"],
    ["ไปกินข้าวกัน", false, "ไปกินข้าวกัน"],
  ])("%s", (input, addressed, rest) => {
    expect(matchKeyword(input, KW)).toEqual({ addressed, rest });
  });
});

describe("cleanAnswer", () => {
  it("keeps auntie's voice", () => {
    expect(cleanAnswer("ป้า: สวัสดีครับหลาน")).toBe("สวัสดีจ้ะหลาน");
    expect(cleanAnswer("   ")).toBeNull();
  });
});
