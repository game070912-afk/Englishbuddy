import { AppError } from "@/lib/api/errors";

/**
 * 内置供应商预设。
 * 只放「地址 + 默认模型」两件事，换供应商不需要改任何业务代码。
 */
const PROVIDER_PRESETS = {
  /** 智谱开放平台：GLM-4.7-Flash 完全免费，国内直连，学生项目首选 */
  zhipu: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.7-flash",
  },
  /** DeepSeek：性价比高，需要充值 */
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  },
} as const;

type ProviderName = keyof typeof PROVIDER_PRESETS;

/** 默认走免费供应商，让克隆仓库的人零成本就能跑起来 */
const DEFAULT_PROVIDER: ProviderName = "zhipu";

export interface AiConfig {
  provider: ProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
}

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

/** 判断字符串是否是已知的供应商名 */
function isProviderName(value: string | undefined): value is ProviderName {
  return value === "zhipu" || value === "deepseek";
}

/** 取第一个非空的环境变量值 */
function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

/**
 * 解析 AI 配置。优先级：显式环境变量 > 供应商预设 > 默认供应商。
 * `DEEPSEEK_*` 是旧变量名，保留兼容，建议改用 `AI_*`。
 */
export function resolveAiConfig(): AiConfig {
  const rawProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
  const legacyBaseUrl = process.env.DEEPSEEK_BASE_URL?.trim();

  // 只填了旧版地址时，认为用户想用 DeepSeek，避免预设模型张冠李戴
  const provider: ProviderName = isProviderName(rawProvider)
    ? rawProvider
    : legacyBaseUrl
      ? "deepseek"
      : DEFAULT_PROVIDER;

  const preset = PROVIDER_PRESETS[provider];

  const baseUrl =
    firstNonEmpty(process.env.AI_BASE_URL, legacyBaseUrl) ?? preset.baseUrl;
  const apiKey = firstNonEmpty(process.env.AI_API_KEY, process.env.DEEPSEEK_API_KEY) ?? "";
  const model = firstNonEmpty(process.env.AI_MODEL, process.env.DEEPSEEK_MODEL) ?? preset.model;

  return { provider, baseUrl, apiKey, model };
}

/**
 * 提前校验 AI 配置是否就绪，让接口能在开流之前就返回明确错误。
 */
export function assertAiConfigured(): void {
  const { apiKey } = resolveAiConfig();

  if (!apiKey) {
    throw new AppError("AI 服务尚未配置，请检查环境变量", "AI_NOT_CONFIGURED", 500);
  }
}

/**
 * 调用 OpenAI 兼容的聊天接口并以流的形式返回原始响应体。
 * 密钥只在本模块（服务端）读取，绝不出现在客户端代码中。
 */
export async function createChatCompletionStream(
  options: ChatCompletionOptions,
): Promise<ReadableStream<Uint8Array>> {
  assertAiConfigured();
  const { baseUrl, apiKey, model } = resolveAiConfig();

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? model,
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
