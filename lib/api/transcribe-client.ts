import type { TranscribeResponse } from "@/lib/types/transcribe";

/**
 * 浏览器端调用 `/api/transcribe`。
 *
 * 组件里不允许直接 fetch，浏览器侧的调用统一收在这里。
 * 真正的 ASR 密钥始终留在服务端，浏览器只把录音发给自己的接口。
 */

/** 从错误响应里取出中文提示 */
function extractMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const error = (payload as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message ? message : null;
}

/**
 * 把录音（base64 的 WAV）送去转写。
 * 失败时抛出的是已经可以直接展示给用户的中文提示。
 */
export async function requestTranscription(audioBase64: string): Promise<string> {
  let response: Response;

  try {
    response = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: audioBase64 }),
    });
  } catch {
    throw new Error("网络不太稳定，语音识别失败了");
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(extractMessage(payload) ?? "语音识别失败了，请再试一次");
  }

  const text = (payload as TranscribeResponse | null)?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("没听清，请再说一次");
  }

  return text.trim();
}
