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
  /**
   * 生成长度上限。
   * 这不是为了省钱，而是为了**响应时间**：免费模型的输出是按 token 一个一个吐的，
   * 不设上限时它偶尔会啰嗦一大段，用户就得干等。设了上限，最坏情况是可预期的。
   */
  maxTokens?: number;
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

/** 一个可用的上游端点：地址 + 密钥 + 模型 */
interface Endpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * 解析备用供应商配置。
 * 三条都填了才算启用，避免只填一半时静默发到错误的地址。
 */
export function resolveFallbackConfig(): Endpoint | null {
  const baseUrl = process.env.AI_FALLBACK_BASE_URL?.trim();
  const apiKey = process.env.AI_FALLBACK_API_KEY?.trim();
  const model = process.env.AI_FALLBACK_MODEL?.trim();

  if (!baseUrl || !apiKey || !model) {
    return null;
  }

  return { baseUrl, apiKey, model };
}

/**
 * 遇到限流（429）或上游抽风（5xx）时的退避等待（毫秒），逐次拉长。
 *
 * 实测智谱免费档的 429 是「一阵一阵」的：刚被限流时立刻重试基本还是 429，
 * 等一两秒再打往往就成了。原来固定等 800ms 只重试一次，等于没重试，
 * 用户看到的就是一句「AI 服务暂时不可用」——像是坏了，其实只是太急。
 */
const RETRY_BACKOFF_MS = [1200, 3000];

/** 单次退避的上限：宁可失败也别让用户对着转圈干等十来秒 */
const MAX_BACKOFF_MS = 4000;

/** 等待指定毫秒；仅用于退避重试 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 读取上游建议的重试间隔（Retry-After，单位秒）。
 * 缺失、不是数字或长到离谱时返回 null，由调用方用默认退避。
 */
function readRetryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) {
    return null;
  }

  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return Math.min(seconds * 1000, MAX_BACKOFF_MS);
}

/**
 * 向一个端点发起请求，内部处理两类重试：
 *
 * 1. 429 / 5xx：逐步退避重试（尊重上游的 Retry-After）
 * 2. 400 且请求里带了 thinking：上游不认识这个参数，去掉后再试一次
 *
 * 网络层异常直接转成中文错误抛出，不在这里兜底。
 */
async function sendWithRetry(
  endpoint: Endpoint,
  options: ChatCompletionOptions,
  disableThinking: boolean,
): Promise<Response> {
  /**
   * 智谱 GLM-4.5 起是「混合推理」模型，默认会先内部思考再回答。
   * 思考 token 有两个坏处：拖慢首字延迟；更糟的是如果 max_tokens 给小了，
   * 额度全被思考吃掉，模型一个可见字都吐不出来（表现为 200 但内容为空）。
   * 陪练场景不需要思考，所以智谱供应商下明确关掉。
   */
  const buildPayload = (thinking: boolean): string =>
    JSON.stringify({
      model: options.model ?? endpoint.model,
      messages: options.messages,
      stream: true,
      temperature: options.temperature ?? 0.7,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(thinking ? { thinking: { type: "disabled" } } : {}),
    });

  let thinking = disableThinking;
  let payload = buildPayload(thinking);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${endpoint.apiKey}`,
  };

  const send = async (): Promise<Response> => {
    try {
      return await fetch(`${endpoint.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: payload,
        signal: options.signal,
      });
    } catch (error) {
      console.error("[EnglishBuddy] 调用 AI 接口失败：", error);
      throw new AppError("网络连接不稳定，请稍后再试", "AI_UPSTREAM_ERROR", 502);
    }
  };

  let response = await send();

  // 上游抽风（5xx）或被限流（429）时逐步退避重试
  for (let attempt = 0; attempt < RETRY_BACKOFF_MS.length; attempt += 1) {
    if (response.ok || !(response.status === 429 || response.status >= 500)) {
      break;
    }

    const waitMs = readRetryAfterMs(response) ?? RETRY_BACKOFF_MS[attempt];
    console.warn(
      `[EnglishBuddy] 上游返回 ${response.status}，等待 ${waitMs}ms 后重试（第 ${attempt + 1} 次）`,
    );
    await sleep(waitMs);
    response = await send();
  }

  // 上游不认识 thinking 参数时，去掉它再试一次，保证换模型也不会挂
  if (!response.ok && response.status === 400 && thinking) {
    console.warn("[EnglishBuddy] 上游不支持 thinking 参数，去掉后重试");
    thinking = false;
    payload = buildPayload(false);
    response = await send();
  }

  return response;
}

/**
 * 调用 OpenAI 兼容的聊天接口并以流的形式返回原始响应体。
 * 密钥只在本模块（服务端）读取，绝不出现在客户端代码中。
 *
 * 主供应商扛不住时自动切备用（`AI_FALLBACK_*` 三条都配了才启用）。
 * 免费额度本来就会一阵一阵地抽风，靠单点硬扛，演示时翻车是迟早的事。
 */
export async function createChatCompletionStream(
  options: ChatCompletionOptions,
): Promise<ReadableStream<Uint8Array>> {
  assertAiConfigured();
  const { baseUrl, apiKey, model, provider } = resolveAiConfig();
  const fallback = resolveFallbackConfig();

  let response = await sendWithRetry({ baseUrl, apiKey, model }, options, provider === "zhipu");

  if (!response.ok || !response.body) {
    if (fallback) {
      console.warn(`[EnglishBuddy] 主供应商返回 ${response.status}，改用备用供应商`);
      // 备用是哪家不确定，所以不带任何厂商特有参数
      const fallbackResponse = await sendWithRetry(fallback, options, false);

      if (fallbackResponse.ok && fallbackResponse.body) {
        return fallbackResponse.body;
      }
      response = fallbackResponse;
    }

    console.error("[EnglishBuddy] AI 接口返回异常状态：", response.status);

    // 被限流和真故障要分开说：前者等几秒就好，说成「服务不可用」会让用户以为坏了
    if (response.status === 429) {
      throw new AppError("AI 有点忙，请稍等几秒再发一次 🙏", "AI_RATE_LIMITED", 429);
    }

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
