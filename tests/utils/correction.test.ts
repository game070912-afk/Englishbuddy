import { describe, expect, it } from "vitest";

import { MAX_CORRECTION_ITEMS, limitCorrectionItems, parseCorrectionLine } from "@/lib/utils/correction";
import type { CorrectionItem } from "@/lib/types/correction";

describe("parseCorrectionLine", () => {
  it("解析修正后的整段文本", () => {
    const event = parseCorrectionLine('{"kind":"corrected","text":"I want to practice."}');

    expect(event).toEqual({ type: "corrected", text: "I want to practice." });
  });

  it("解析单条纠错意见", () => {
    const line =
      '{"kind":"item","original":"I wants","suggestion":"I want","type":"grammar","explanation":"主语 I 后接动词原形"}';
    const event = parseCorrectionLine(line);

    expect(event?.type).toBe("item");
    if (event?.type === "item") {
      expect(event.item.original).toBe("I wants");
      expect(event.item.type).toBe("grammar");
    }
  });

  it("非法 JSON 返回 null", () => {
    expect(parseCorrectionLine("{not json")).toBeNull();
  });

  it("缺少必填字段或类型非法时返回 null", () => {
    expect(parseCorrectionLine('{"kind":"item","original":"a","suggestion":"b","type":"unknown"}')).toBeNull();
    expect(parseCorrectionLine('{"kind":"item","original":"","suggestion":"b","type":"grammar"}')).toBeNull();
  });

  it("非 JSON 内容（如 markdown 说明）返回 null", () => {
    expect(parseCorrectionLine("这是说明文字")).toBeNull();
  });
});

describe("limitCorrectionItems", () => {
  it("限制条目数量", () => {
    const items: CorrectionItem[] = Array.from({ length: MAX_CORRECTION_ITEMS + 5 }, (_, index) => ({
      original: `old-${index}`,
      suggestion: `new-${index}`,
      type: "grammar",
      explanation: "说明",
    }));

    expect(limitCorrectionItems(items)).toHaveLength(MAX_CORRECTION_ITEMS);
  });
});
