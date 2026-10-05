import { AppError } from "@/lib/api/errors";
import { MAX_AUDIO_BYTES, base64ByteLength, isBase64 } from "@/lib/utils/audio";

/**
 * 语音转写（ASR）客户端。
 *
 * 与设计保持一致的两条约束：
 * 1. 密钥只在这里（服务端）读取，绝不进客户端代码
 * 2. 转写能力收在一处，换 ASR 供应商只改这个文件
 *
 * 供应商变迁（为什么现在是 Groq）：
 * - 初版选的是百度短语音（ADR 0004），在广州本地测试全通；
 * - 上线后才发现**百度的语音接口从海外服务器访问不通**——Vercel 的函数
 *   无论落在美国还是新加坡，连 vop.baidu.com 都直接超时。
 *   这是选型时只在国内网络里实测留下的盲区，后来补进了 ADR 的复核记录；
 * - 改用 Groq 的 whisper-large-v3：免费额度内、海外访问畅通，部署即用；
 */

/**
 * 用的 Whisper 版本：`whisper-large-v3`（完整版），
 * 而不是更常见的 `whisper-large-v3-turbo`。
 *
 * turbo 是蒸馏出来的精简版，参数少、理论上更快；但用同一段真实英文语音实测下来：
 *
 * | 模型                | 结果               | 耗时    |
 * |-------------------|--------------------|---------|
 * | large-v3-turbo     | 正确，但多一个逗号   | 2123ms  |
 * | large-v3           | 完全正确            | 1067ms  |
 *
 * 完整版不仅更准，这次还更快（turbo 没有体现出速度优势），
 * 两者都在免费额度内，所以没有理由继续用 turbo。
 */
const WHISPER_MODEL = "whisper-large-v3";

/** Groq 的 OpenAI 兼容地址 */
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export interface AsrConfig {
  apiKey: string;
  baseUrl: string;
}

/**
 * 读取 ASR 配置。
 * `ASR_API_KEY` 优先；不填就回落到备用 AI 的 Groq Key——
 * 语音和备用 AI 本来就是同一家，这样部署时少配一个变量。
 */
export function resolveAsrConfig(): AsrConfig {
  const apiKey =
    process.env.ASR_API_KEY?.trim() || process.env.AI_FALLBACK_API_KEY?.trim() || "";
  const baseUrl = process.env.ASR_BASE_URL?.trim() || GROQ_BASE_URL;
  return { apiKey, baseUrl };
}

/**
 * 语音识别是否已配置好。
 * 页面用它来决定要不要显示麦克风按钮——没配就干脆不出现，
 * 好过让用户点一下才发现用不了。
 */
export function isAsrConfigured(): boolean {
  return Boolean(resolveAsrConfig().apiKey);
}

/** 提前校验配置是否就绪，让用户不用白等一轮网络往返 */
export function assertAsrConfigured(): void {
  if (!isAsrConfigured()) {
    throw new AppError("语音识别还没配置好，请检查环境变量", "ASR_NOT_CONFIGURED", 501);
  }
}

/**
 * 解析 Groq Whisper 的返回结果。
 * 成功返回文本；空文本多半是环境太安静或根本没说话。
 */
export function parseTranscriptionPayload(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new AppError("语音识别返回了异常内容，请再试一次", "ASR_UPSTREAM_ERROR", 502);
  }

  const text = (payload as Record<string, unknown>).text;

  if (typeof text !== "string") {
    throw new AppError("语音识别返回了异常内容，请再试一次", "ASR_UPSTREAM_ERROR", 502);
  }

  const trimmed = text.trim();

  if (!trimmed) {
    throw new AppError("没听清，请再说一次", "ASR_UPSTREAM_ERROR", 502);
  }

  return trimmed;
}

/** 把 Whisper 接口的异常状态码翻译成中文提示 */
function describeHttpError(status: number): AppError {
  if (status === 401 || status === 403) {
    return new AppError("语音识别的密钥好像填错了，请检查配置", "ASR_UPSTREAM_ERROR", 502);
  }

  if (status === 429) {
    return new AppError("语音识别这会儿有点忙，请稍后再试", "ASR_UPSTREAM_ERROR", 429);
  }

  return new AppError("语音识别服务暂时不可用，请稍后再试", "ASR_UPSTREAM_ERROR", 502);
}

/**
 * 把一段 WAV(16kHz/16bit/单声道) 的 base64 转成文字。
 * 调用前不需要自己校验配置，这里会先挡一道。
 */
export async function transcribeWav(base64Audio: string): Promise<string> {
  assertAsrConfigured();

  if (!isBase64(base64Audio) || !base64Audio) {
    throw new AppError("录音格式不正确", "INVALID_REQUEST", 400);
  }

  // 直接按字节数挡一道，避免把超长录音发上去白跑一趟
  const byteLength = base64ByteLength(base64Audio);
  if (byteLength <= 0 || byteLength > MAX_AUDIO_BYTES) {
    throw new AppError("录音太长了，请控制在 60 秒内", "INVALID_REQUEST", 400);
  }

  const { apiKey, baseUrl } = resolveAsrConfig();

  // Whisper 走 multipart 上传；参数名用英文，与上游 API 保持一致
  const form = new FormData();
  form.append(
    "file",
    new Blob([Buffer.from(base64Audio, "base64")], { type: "audio/wav" }),
    "audio.wav",
  );
  form.append("model", WHISPER_MODEL);
  form.append("language", "en"); // 英语陪练场景，强制按英文识别
  form.append("response_format", "json");
  form.append("temperature", "0");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch {
    console.error("[EnglishBuddy] 调用语音识别服务失败");
    throw new AppError("网络连接不稳定，语音识别失败了", "ASR_UPSTREAM_ERROR", 502);
  }

  if (!response.ok) {
    console.error("[EnglishBuddy] 语音识别服务返回异常状态：", response.status);
    throw describeHttpError(response.status);
  }

  const payload: unknown = await response.json().catch(() => null);
  return parseTranscriptionPayload(payload);
}
