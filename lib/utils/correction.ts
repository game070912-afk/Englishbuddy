import type { CorrectionItem, CorrectionStreamEvent, CorrectionType } from "@/lib/types/correction";
import { MAX_MESSAGE_LENGTH, sanitizeUserText } from "@/lib/utils/validate";

/** 一次最多返回的纠错条目数 */
export const MAX_CORRECTION_ITEMS = 10;
/** 单条说明的最大字符数 */
const MAX_EXPLANATION_LENGTH = 200;

/** 合法的错误类型 */
const VALID_TYPES: readonly CorrectionType[] = ["grammar", "word", "style", "expression"];

/** 判断是否为合法错误类型 */
function isCorrectionType(value: unknown): value is CorrectionType {
  return typeof value === "string" && VALID_TYPES.includes(value as CorrectionType);
}

/**
 * 解析模型输出的单行 JSONL。
 * 解析失败或字段非法时返回 null，调用方直接跳过该行。
 */
export function parseCorrectionLine(line: string): CorrectionStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;

  if (record.kind === "corrected" && typeof record.text === "string") {
    return { type: "corrected", text: sanitizeUserText(record.text, MAX_MESSAGE_LENGTH) };
  }

  if (record.kind === "item") {
    const original = typeof record.original === "string" ? sanitizeUserText(record.original, 200) : "";
    const suggestion = typeof record.suggestion === "string" ? sanitizeUserText(record.suggestion, 200) : "";
    const explanation =
      typeof record.explanation === "string" ? sanitizeUserText(record.explanation, MAX_EXPLANATION_LENGTH) : "";

    if (!original || !suggestion || !isCorrectionType(record.type)) {
      return null;
    }

    const item: CorrectionItem = {
      original,
      suggestion,
      type: record.type,
      explanation,
    };
    return { type: "item", item };
  }

  return null;
}

/** 限制纠错条目数量，避免模型输出过多内容 */
export function limitCorrectionItems(items: CorrectionItem[]): CorrectionItem[] {
  return items.slice(0, MAX_CORRECTION_ITEMS);
}
