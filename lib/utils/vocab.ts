import type { VocabDraft } from "@/lib/types/vocab";
import { sanitizeUserText } from "@/lib/utils/validate";

/**
 * 各字段的长度上限。
 * 数据库没有加长度约束，所以在这里拦一道，避免 AI 偶尔啰嗦时写出一大段塞进卡片。
 */
const FIELD_LIMITS = {
  word: 60,
  phonetic: 40,
  definition: 200,
  example_sentence: 240,
  context: 240,
} as const;

/** 模型偶尔会用 markdown 代码块包住 JSON，这里把围栏去掉 */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? (fenced[1] ?? trimmed) : trimmed;
}

/** 取字符串里的第一个 `{` 到最后一个 `}`，用于截掉前后的多余说明文字 */
function sliceJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start >= 0 && end > start ? raw.slice(start, end + 1) : null;
}

/** 把任意值收敛成清洗后的字符串，非字符串或空串返回 null */
function toOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = sanitizeUserText(value, maxLength);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * 解析 AI 输出的单词卡片 JSON。
 *
 * 之所以写得这么宽容：免费模型并不总是老老实实只输出 JSON，
 * 偶尔会先来一句「好的，这是你要的卡片：」。与其直接报错让用户重试，
 * 不如先把明显能救回来的情况救回来。解析不出来时返回 null，由调用方决定重试或报错。
 */
export function parseVocabDraft(raw: string): VocabDraft | null {
  const cleaned = stripCodeFence(raw);

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const sliced = sliceJsonObject(cleaned);
    if (!sliced) {
      return null;
    }
    try {
      parsed = JSON.parse(sliced);
    } catch {
      return null;
    }
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;

  // word 是唯一必须有值的字段，没有它这张卡片就没有意义
  const word = toOptionalString(candidate.word, FIELD_LIMITS.word);
  if (!word) {
    return null;
  }

  return {
    word,
    phonetic: toOptionalString(candidate.phonetic, FIELD_LIMITS.phonetic),
    definition: toOptionalString(candidate.definition, FIELD_LIMITS.definition),
    example_sentence: toOptionalString(
      candidate.example_sentence ?? candidate.example,
      FIELD_LIMITS.example_sentence,
    ),
    context: toOptionalString(candidate.context, FIELD_LIMITS.context),
  };
}
