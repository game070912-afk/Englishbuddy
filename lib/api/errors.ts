/** 服务端统一错误类型，携带面向用户的中文提示 */

export type AppErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "AI_NOT_CONFIGURED"
  | "AI_UPSTREAM_ERROR"
  | "AI_STREAM_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  /** 面向用户的中文提示，可直接展示 */
  readonly userMessage: string;
  /** 便于排查的错误码 */
  readonly code: AppErrorCode;
  /** HTTP 状态码 */
  readonly status: number;

  constructor(userMessage: string, code: AppErrorCode, status: number) {
    super(`${code}: ${userMessage}`);
    this.name = "AppError";
    this.userMessage = userMessage;
    this.code = code;
    this.status = status;
  }
}

/** 把未知异常转成 AppError，避免把技术细节暴露给用户 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  // 技术细节只在服务端日志保留
  console.error("[EnglishBuddy] 未预期的错误：", error);
  return new AppError("服务开小差了，请稍后再试", "INTERNAL_ERROR", 500);
}
