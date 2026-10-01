import { AppError } from "@/lib/api/errors";

/** DeepSeek 接口地址，可通过环境变量覆盖（便于自建代理） */
const DEFAULT_BASE_URL = "https://api.deepseek.com";
/** 默认模型 */
export const DEFAULT_MODEL = "deepseek-chat";

/** 兼容 OpenAI 消息格式 */
export interface CompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  messages: CompletionMessage[];
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}

/** 读取环境变量中的配置，缺失时使用默认值 */
function resolveConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
  return { baseUrl, apiKey };
}

/**
 * 调用 DeepSeek 聊天接口并以流的形式返回原始响应体。
 * 密钥只在本模块（服务端）读取，绝不出现在客户端代码中。
 */
export async function createChatCompletionStream(
  options: ChatCompletionOptions,
): Promise<ReadableStream<Uint8Array>> {
  const { baseUrl, apiKey } = resolveConfig();

  if (!apiKey) {
    throw new AppError("AI 服务尚未配置，请检查环境变量", "AI_NOT_CONFIGURED", 500);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? DEFAULT_MODEL,
        messages: options.messages,
        stream: true,
        temperature: options.temperature ?? 0.7,
      }),
      signal: options.signal,
    });
  } catch (error) {
    console.error("[EnglishBuddy] 调用 AI 接口失败：", error);
    throw new AppError("网络连接不稳定，请稍后再试", "AI_UPSTREAM_ERROR", 502);
  }

  if (!response.ok || !response.body) {
    console.error("[EnglishBuddy] AI 接口返回异常状态：", response.status);
    throw new AppError("AI 服务暂时不可用，请稍后再试", "AI_UPSTREAM_ERROR", 502);
  }

  return response.body;
}

/**
 * 把上游 SSE 流解析为纯文本增量，逐段 yield。
 * 只取出 delta.content，忽略推理内容与结束标记。
 */
export async function* streamTextDeltas(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      // 最后一段可能不完整，留在缓冲区等待下一次拼接
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const payload = line.trim();
        if (!payload.startsWith("data:")) {
          continue;
        }
        const data = payload.slice(5).trim();
        if (!data || data === "[DONE]") {
          continue;
        }
        const text = extractDeltaText(data);
        if (text) {
          yield text;
        }
      }
    }
  } catch (error) {
    console.error("[EnglishBuddy] 解析 AI 流式响应失败：", error);
    throw new AppError("AI 回复中断了，请再试一次", "AI_STREAM_ERROR", 502);
  } finally {
    reader.releaseLock();
  }
}

/** 从单条 SSE 数据中取出增量文本，解析失败时返回空字符串 */
function extractDeltaText(data: string): string {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null) {
      return "";
    }
    const choices = (parsed as Record<string, unknown>).choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return "";
    }
    const delta = (choices[0] as Record<string, unknown>).delta;
    if (typeof delta !== "object" || delta === null) {
      return "";
    }
    const content = (delta as Record<string, unknown>).content;
    return typeof content === "string" ? content : "";
  } catch {
    // 单条数据解析失败不影响整体流
    return "";
  }
}
