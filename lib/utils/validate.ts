import type { ChatMessage, ChatRequestBody, EnglishLevel } from "@/lib/types/chat";

/** 单条对话消息的最大字符数 */
export const MAX_MESSAGE_LENGTH = 2000;
/** 单次请求携带的最大历史消息条数 */
export const MAX_HISTORY_COUNT = 20;
/** 话题的最大字符数 */
export const MAX_TOPIC_LENGTH = 100;
/** 词汇查询的最大字符数 */
export const MAX_WORD_LENGTH = 100;

/** 合法难度取值，用于运行时校验 */
const VALID_LEVELS: readonly EnglishLevel[] = ["beginner", "intermediate", "advanced"];

/** 控制字符（含 DEL）的匹配规则 */
const CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F]/g;

/**
 * 清洗用户输入：去除首尾空白、剔除控制字符，并按最大长度截断。
 * React 渲染文本节点时会自动转义，因此这里只做长度与非法字符处理。
 */
export function sanitizeUserText(input: string, maxLength: number): string {
  const withoutControlChars = input.replace(CONTROL_CHARS_PATTERN, "");
  return withoutControlChars.trim().slice(0, maxLength);
}

/** 判断是否为非空字符串 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断是否为合法难度等级 */
export function isEnglishLevel(value: unknown): value is EnglishLevel {
  return typeof value === "string" && VALID_LEVELS.includes(value as EnglishLevel);
}

/** 判断未知数据是否为一条合法消息 */
export function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.id) &&
    (candidate.role === "user" || candidate.role === "assistant") &&
    isNonEmptyString(candidate.content)
  );
}

/**
 * 按字符预算裁剪历史消息，只保留最近的内容。
 *
 * 只限制「条数」是不够的：20 条长消息能塞进去几万字符，
 * 输入越长，模型开始吐第一个字之前的等待就越久。
 * 这里按总字符数兜底，并且**至少保留最后一条**（也就是用户刚发的那句）。
 */
export function trimMessagesByBudget<T extends { content: string }>(
  messages: T[],
  budgetChars: number,
): T[] {
  const kept: T[] = [];
  let total = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (!item) {
      continue;
    }

    total += item.content.length;
    if (kept.length > 0 && total > budgetChars) {
      break;
    }

    kept.unshift(item);
  }

  return kept;
}

/**
 * 校验 /api/chat 的请求体。
 * 返回值已做过长度限制与非法字符清洗，可直接安全使用。
 */
export function parseChatRequestBody(raw: unknown): ChatRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("请求体格式不正确");
  }

  const candidate = raw as Record<string, unknown>;
  if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) {
    throw new Error("缺少对话内容");
  }

  const messages = candidate.messages
    .filter(isChatMessage)
    .slice(-MAX_HISTORY_COUNT)
    .map((item) => ({
      id: sanitizeUserText(item.id, 100),
      role: item.role,
      content: sanitizeUserText(item.content, MAX_MESSAGE_LENGTH),
    }));

  if (messages.length === 0) {
    throw new Error("对话内容为空");
  }

  const result: ChatRequestBody = { messages };

  const topic = typeof candidate.topic === "string" ? sanitizeUserText(candidate.topic, MAX_TOPIC_LENGTH) : "";
  if (topic) {
    result.topic = topic;
  }

  if (isEnglishLevel(candidate.level)) {
    result.level = candidate.level;
  }

  return result;
}
