/** 对话相关共享类型定义 */

/** 英语水平分级 */
export type EnglishLevel = "beginner" | "intermediate" | "advanced";

/** 消息发送方 */
export type ChatRole = "user" | "assistant";

/** 一条对话消息 */
export interface ChatMessage {
  /** 消息唯一标识，前端用于列表 key */
  id: string;
  /** 发送方 */
  role: ChatRole;
  /** 消息正文 */
  content: string;
}

/** POST /api/chat 的请求体 */
export interface ChatRequestBody {
  /** 历史消息（含本次用户提问） */
  messages: ChatMessage[];
  /** 练习话题，如 "面试" / "旅行" */
  topic?: string;
  /** 难度等级 */
  level?: EnglishLevel;
}

/** 服务端推送（SSE）的事件结构 */
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; reason: "stop" | "length" }
  | { type: "error"; message: string };

/** 接口出错时返回的结构 */
export interface ChatErrorResponse {
  error: {
    /** 面向用户的中文提示 */
    message: string;
    /** 便于排查的错误码 */
    code: string;
  };
}
