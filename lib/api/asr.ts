import { AppError } from "@/lib/api/errors";
import { MAX_AUDIO_BYTES, TARGET_SAMPLE_RATE, base64ByteLength, isBase64 } from "@/lib/utils/audio";

/**
 * 语音转写（ASR）客户端。
 *
 * 与设计保持一致的两条约束：
 * 1. 密钥只在这里（服务端）读取，绝不进客户端代码
 * 2. 转写能力收在一处，将来换 ASR 供应商只改这个文件
 *
 * 当前供应商：百度短语音识别标准版（英文，`dev_pid=1737`），
 * 选型理由见 docs/decisions/0004-语音输入转写方案.md。
 */

/** 百度短语音识别的英文模型 id */
const DEV_PID_ENGLISH = 1737;

/** 百度要求的设备标识，一个稳定的字符串即可 */
const CUID = "englishbuddy-web";

/** 换取 access_token 的地址 */
const TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token";

/** 短语音识别接口地址 */
const ASR_URL = "https://vop.baidu.com/server_api";

/** token 提前多少毫秒失效，避开边界上拿到已过期 token */
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/** 拿不到 expires_in 时的兜底有效期（30 天） */
const DEFAULT_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AsrConfig {
  apiKey: string;
  secretKey: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

/**
 * 进程内缓存 token。
 * Serverless 每个实例各自缓存，冷启动会各自换一次——可以接受，
 * 因为 token 本身有效期 30 天，换取成本极低。
 */
let tokenCache: TokenCache | null = null;

/** 读取 ASR 配置 */
export function resolveAsrConfig(): AsrConfig {
  return {
    apiKey: process.env.BAIDU_ASR_API_KEY?.trim() ?? "",
    secretKey: process.env.BAIDU_ASR_SECRET_KEY?.trim() ?? "",
  };
}

/**
 * 语音识别是否已配置好。
 * 页面用它来决定要不要显示麦克风按钮——没配就干脆不出现，
 * 好过让用户点一下才发现用不了。
 */
export function isAsrConfigured(): boolean {
  const { apiKey, secretKey } = resolveAsrConfig();
  return Boolean(apiKey && secretKey);
}

/** 提前校验配置是否就绪，让用户不用白等一轮网络往返 */
export function assertAsrConfigured(): void {
  if (!isAsrConfigured()) {
    throw new AppError("语音识别还没配置好，请检查环境变量", "ASR_NOT_CONFIGURED", 501);
  }
}

/** 清空 token 缓存，测试与故障排查用 */
export function resetAsrTokenCache(): void {
  tokenCache = null;
}

/** 从百度鉴权响应里取出 token 与过期时间 */
function extractToken(payload: unknown): TokenCache | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const token = candidate.access_token;

  if (typeof token !== "string" || !token) {
    return null;
  }

  const expiresIn =
    typeof candidate.expires_in === "number" && candidate.expires_in > 0
      ? candidate.expires_in
      : DEFAULT_TOKEN_TTL_SECONDS;

  return { token, expiresAt: Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS };
}

/** 向百度换取 access_token */
async function requestAccessToken(config: AsrConfig): Promise<TokenCache> {
  const url = `${TOKEN_URL}?grant_type=client_credentials&client_id=${encodeURIComponent(
    config.apiKey,
  )}&client_secret=${encodeURIComponent(config.secretKey)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
  } catch {
    console.error("[EnglishBuddy] 连接百度语音鉴权服务失败");
    throw new AppError("连不上语音识别服务，请稍后再试", "ASR_UPSTREAM_ERROR", 502);
  }

  if (!response.ok) {
    console.error("[EnglishBuddy] 百度语音鉴权返回异常状态：", response.status);
    throw new AppError("语音识别服务暂时不可用，请稍后再试", "ASR_UPSTREAM_ERROR", 502);
  }

  const payload: unknown = await response.json().catch(() => null);
  const cache = extractToken(payload);

  if (!cache) {
    // 百度鉴权失败时不会给明确状态码，只能从响应体判断
    console.error("[EnglishBuddy] 百度语音鉴权响应里没有 token");
    throw new AppError("语音识别的密钥好像填错了，请检查配置", "ASR_UPSTREAM_ERROR", 502);
  }

  return cache;
}

/** 取一个可用的 access_token，命中缓存就直接复用 */
async function getAccessToken(config: AsrConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  tokenCache = await requestAccessToken(config);
  return tokenCache.token;
}

/** 把百度的错误码翻译成人话 */
function describeAsrError(errNo: number): string {
  switch (errNo) {
    case 3301: // 音频质量差
    case 3307: // 后端识别出错
    case 3309: // 音频数据有问题
      return "没听清，换个安静点的地方再说一次";
    case 3302: // 鉴权失败
      return "语音识别的密钥有问题，请检查配置";
    case 3304: // QPS 超限
    case 3305: // 日请求量超限
      return "语音识别这会儿有点忙，请稍后再试";
    case 3308: // 音频过长
    case 3310: // 音频过大
      return "录音太长了，请控制在 60 秒内";
    case 3311: // 采样率不支持
    case 3312: // 格式不支持
      return "录音格式不被支持，请刷新页面重试";
    default:
      return "语音识别失败了，请再试一次";
  }
}

/**
 * 解析百度短语音的返回结果。
 * 成功返回文本，其余情况抛出带中文提示的 AppError。
 */
export function parseAsrPayload(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new AppError("语音识别返回了异常内容，请再试一次", "ASR_UPSTREAM_ERROR", 502);
  }

  const candidate = payload as Record<string, unknown>;
  const errNo = candidate.err_no;

  if (typeof errNo === "number" && errNo !== 0) {
    throw new AppError(describeAsrError(errNo), "ASR_UPSTREAM_ERROR", 502);
  }

  const result = candidate.result;
  const text = Array.isArray(result)
    ? result
        .filter((item): item is string => typeof item === "string")
        .join(" ")
        .trim()
    : "";

  if (!text) {
    // 识别成功但没内容：多半是环境太安静或根本没说话
    throw new AppError("没听清，请再说一次", "ASR_UPSTREAM_ERROR", 502);
  }

  return text;
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

  const config = resolveAsrConfig();
  const token = await getAccessToken(config);

  const body = JSON.stringify({
    format: "wav",
    rate: TARGET_SAMPLE_RATE,
    channel: 1,
    cuid: CUID,
    token,
    speech: base64Audio,
    len: byteLength,
    dev_pid: DEV_PID_ENGLISH,
  });

  let response: Response;
  try {
    response = await fetch(ASR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch {
    console.error("[EnglishBuddy] 调用百度语音识别失败");
    throw new AppError("网络连接不稳定，语音识别失败了", "ASR_UPSTREAM_ERROR", 502);
  }

  if (!response.ok) {
    console.error("[EnglishBuddy] 百度语音识别返回异常状态：", response.status);
    throw new AppError("语音识别服务暂时不可用，请稍后再试", "ASR_UPSTREAM_ERROR", 502);
  }

  const payload: unknown = await response.json().catch(() => null);
  return parseAsrPayload(payload);
}
