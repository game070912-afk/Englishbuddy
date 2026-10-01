/** 语法纠错相关共享类型定义 */

/** 错误类型 */
export type CorrectionType = "grammar" | "word" | "style" | "expression";

/** 单条纠错意见 */
export interface CorrectionItem {
  /** 原文片段 */
  original: string;
  /** 建议写法 */
  suggestion: string;
  /** 错误类型 */
  type: CorrectionType;
  /** 中文说明 */
  explanation: string;
}

/** 纠错结果 */
export interface CorrectionResult {
  /** 修改后的完整文本 */
  corrected: string;
  /** 纠错条目 */
  items: CorrectionItem[];
}

/** POST /api/correct 的请求体 */
export interface CorrectionRequestBody {
  /** 待批改的英文文本 */
  text: string;
}

/** 接口出错时返回的结构 */
export interface CorrectionErrorResponse {
  error: {
    /** 面向用户的中文提示 */
    message: string;
    /** 便于排查的错误码 */
    code: string;
  };
}

/** 服务端推送（SSE）的事件结构 */
export type CorrectionStreamEvent =
  | { type: "corrected"; text: string }
  | { type: "item"; item: CorrectionItem }
  | { type: "done" }
  | { type: "error"; message: string };
