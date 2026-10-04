import { transcribeWav } from "@/lib/api/asr";
import { getCurrentUser } from "@/lib/api/auth";
import { AppError, toAppError } from "@/lib/api/errors";
import { assertAnonymousQuota } from "@/lib/api/usage-guard";
import { isBase64 } from "@/lib/utils/audio";
import type { TranscribeErrorResponse, TranscribeResponse } from "@/lib/types/transcribe";

/**
 * POST /api/transcribe
 * 请求体：{ audio: string } —— 16kHz/16bit/单声道 WAV 的 base64
 * 响应：{ text: string }
 *
 * 浏览器录音转成文字必须经由服务端转发：一是密钥不能出现在前端，
 * 二是国内供应商的语音接口基本都禁止浏览器跨域直连——
 * 这与「密钥只在服务端」的规则天然一致，不是额外妥协。
 */

/** 转写是同步一次性返回，30 秒足够 */
export const maxDuration = 30;

/**
 * base64 长度上限：60 秒 16kHz/16bit 单声道约 1.92MB，
 * base64 膨胀 1/3 后约 2.56MB，留一点余量。
 */
const MAX_BASE64_LENGTH = 2_800_000;

/** 构造统一的错误响应 */
function buildErrorResponse(error: AppError): Response {
  const payload: TranscribeErrorResponse = {
    error: { message: error.userMessage, code: error.code },
  };
  return new Response(JSON.stringify(payload), {
    status: error.status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function buildJsonResponse(payload: TranscribeResponse): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** 校验请求体，挡掉空录音、超长录音和非 base64 内容 */
function parseRequestBody(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("请求内容格式不正确", "INVALID_REQUEST", 400);
  }

  const audio = (raw as Record<string, unknown>).audio;

  if (typeof audio !== "string" || !audio) {
    throw new AppError("没有收到录音，请再说一次", "INVALID_REQUEST", 400);
  }

  if (audio.length > MAX_BASE64_LENGTH) {
    throw new AppError("录音太长了，请控制在 60 秒内", "INVALID_REQUEST", 400);
  }

  if (!isBase64(audio)) {
    throw new AppError("录音格式不正确", "INVALID_REQUEST", 400);
  }

  return audio;
}

export async function POST(request: Request): Promise<Response> {
  // 匿名可以试用，但限量；登录用户不受限
  const user = await getCurrentUser();

  try {
    if (!user) {
      assertAnonymousQuota(request);
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new AppError("请求内容格式不正确", "INVALID_REQUEST", 400);
    }

    const audio = parseRequestBody(raw);
    const text = await transcribeWav(audio);

    return buildJsonResponse({ text });
  } catch (error) {
    return buildErrorResponse(toAppError(error));
  }
}
