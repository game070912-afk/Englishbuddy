/**
 * 对话草稿的本地暂存。
 *
 * 为什么需要它：`/chat` 和 `/history` 是两个独立页面路由，
 * 在它们之间跳转等于整页导航，ChatPanel 会被卸载重建，
 * 只活在 useState 里的对话就整段消失了。
 *
 * 存在 sessionStorage 而不是 localStorage，是刻意的取舍：
 * - 切页面、刷新都还在（解决「切到历史再切回来消息没了」）
 * - 关掉标签页就清空（草稿本来就不该长期占着用户磁盘）
 * - 每个标签页互不干扰，符合「一次练习」的心智模型
 *
 * 已登录用户的对话另外还有一份存在数据库（见 /api/conversations），
 * 那边负责长期留存，这边只负责「别让正在打的内容凭空消失」。
 */

import type { ChatMessage, EnglishLevel } from "@/lib/types/chat";

/** sessionStorage 的键名 */
const DRAFT_KEY = "englishbuddy:chat-draft";

/** 一份草稿包含的全部内容 */
export interface ChatDraft {
  messages: ChatMessage[];
  input: string;
  topic: string;
  level: EnglishLevel;
  conversationId: string | null;
}

/**
 * 空草稿。
 * 必须是**稳定引用**：它同时充当 useSyncExternalStore 的服务端快照，
 * 每次返回新对象会让 React 认为快照一直在变，进而死循环。
 */
export const EMPTY_DRAFT: ChatDraft = {
  messages: [],
  input: "",
  topic: "",
  level: "intermediate",
  conversationId: null,
};

/** 合法的难度取值，用来校验读出来的数据 */
const LEVELS: ReadonlyArray<EnglishLevel> = ["beginner", "intermediate", "advanced"];

/** 单条消息最多保留多少字，防止异常数据撑爆存储 */
const MAX_CONTENT_LENGTH = 20_000;
/** 最多恢复多少条消息，超出说明数据异常，宁可少恢复也不要卡住页面 */
const MAX_MESSAGES = 200;

/** 判断读出来的对象是不是一条合法消息 */
function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    (item.role === "user" || item.role === "assistant") &&
    typeof item.content === "string"
  );
}

/**
 * 读取草稿。
 * 存储里的内容可能是旧版本写的、也可能被人为改坏，所以逐字段校验，
 * 任一项不对就整份丢弃返回空——宁可让用户重打一句，也不要渲染崩溃。
 */
export function readChatDraft(): ChatDraft {
  if (typeof window === "undefined") {
    return EMPTY_DRAFT;
  }

  const raw = window.sessionStorage.getItem(DRAFT_KEY);
  if (!raw) {
    return EMPTY_DRAFT;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_DRAFT;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return EMPTY_DRAFT;
  }

  const draft = parsed as Record<string, unknown>;

  const messages = Array.isArray(draft.messages)
    ? draft.messages.filter(isChatMessage).slice(0, MAX_MESSAGES).map((message) => ({
        ...message,
        content: message.content.slice(0, MAX_CONTENT_LENGTH),
      }))
    : [];

  const level = LEVELS.includes(draft.level as EnglishLevel)
    ? (draft.level as EnglishLevel)
    : EMPTY_DRAFT.level;

  return {
    messages,
    input: typeof draft.input === "string" ? draft.input : "",
    topic: typeof draft.topic === "string" ? draft.topic : "",
    level,
    conversationId: typeof draft.conversationId === "string" ? draft.conversationId : null,
  };
}

/**
 * 写入草稿。
 * 内容为空时直接删掉键，不让空对象一直占着存储。
 */
export function writeChatDraft(draft: ChatDraft): void {
  if (typeof window === "undefined") {
    return;
  }

  const isEmpty = draft.messages.length === 0 && !draft.input.trim() && !draft.topic.trim();

  try {
    if (isEmpty) {
      window.sessionStorage.removeItem(DRAFT_KEY);
      return;
    }
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // 存储写满或被禁用（比如无痕模式）时静默失败，不影响聊天本身
  }
}

/** 主动清空草稿，供「重新开始」这类操作调用 */
export function clearChatDraft(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // 同上，失败也不影响主流程
  }
}
