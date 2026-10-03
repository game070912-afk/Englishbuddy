import {
  assertAiConfigured,
  createChatCompletionStream,
  streamTextDeltas,
  type CompletionMessage,
} from "@/lib/api/ai";
import { getCurrentUser } from "@/lib/api/auth";
import { AppError, toAppError } from "@/lib/api/errors";
import { buildCorrectorSystemPrompt } from "@/lib/api/prompts";
import { assertAnonymousQuota } from "@/lib/api/usage-guard";
import type {
  CorrectionRequestBody,
  CorrectionStreamEvent,
  CorrectionErrorResponse,
} from "@/lib/types/correction";
import { parseCorrectionLine } from "@/lib/utils/correction";
import { MAX_MESSAGE_LENGTH, sanitizeUserText } from "@/lib/utils/validate";

/** 部署到 Vercel 时允许的最长执行时间（流式批改需要） */
export const maxDuration = 60;

/** 事件流的编码工具 */
const encoder = new TextEncoder();
/** 最多重试一次 */
const MAX_ATTEMPTS = 2;
/** 匿名访客单次可批改的字符数上限 */
const ANONYMOUS_TEXT_LIMIT = 600;
/**
 * 批改结果的生成上限。
 * 输入最多 2000 字符，输出是「改后全文 + 最多 10 条问题」，1600 留了余量；
 * 主要是防止模型在解释上没完没了。
 */
const CORRECTION_MAX_TOKENS = 1600;

/** 把事件序列化为 SSE 格式 */
function toSseEvent(event: CorrectionStreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** 构造统一的错误响应 */
function buildErrorResponse(error: AppError): Response {
  const payload: CorrectionErrorResponse = {
    error: { message: error.userMessage, code: error.code },
  };
  return new Response(JSON.stringify(payload), {
    status: error.status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * POST /api/correct
 * 请求体：{ text: string }
 * 响应：text/event-stream，事件结构见 CorrectionStreamEvent
 */
export async function POST(request: Request): Promise<Response> {
  // 匿名可以试用，但限量；登录用户不受限
  const user = await getCurrentUser();

  try {
    if (!user) {
      assertAnonymousQuota(request);
    }
  } catch (error) {
    return buildErrorResponse(toAppError(error));
  }

  let text: string;

  try {
    const raw: unknown = await request.json();
    const body = raw as CorrectionRequestBody;
    if (typeof body?.text !== "string" || body.text.trim().length === 0) {
      throw new Error("缺少待批改的文本");
    }
    const limit = user ? MAX_MESSAGE_LENGTH : ANONYMOUS_TEXT_LIMIT;
    text = sanitizeUserText(body.text, limit);
  } catch {
    return buildErrorResponse(new AppError("请求内容格式不正确", "INVALID_REQUEST", 400));
  }

  const messages: CompletionMessage[] = [
    { role: "system", content: buildCorrectorSystemPrompt() },
    { role: "user", content: text },
  ];

  // 开流之前先确认配置就绪，避免客户端收到 200 却拿不到内容
  try {
    assertAiConfigured();
  } catch (error) {
    return buildErrorResponse(toAppError(error));
  }

  const outputStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // 第一次按默认温度生成，若完全解析不出内容则用更严格的参数重试一次
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
          const parsedCount = await streamOneAttempt(controller, messages, attempt === MAX_ATTEMPTS);

          if (parsedCount > 0) {
            controller.enqueue(toSseEvent({ type: "done" }));
            return;
          }
        }

        controller.enqueue(
          toSseEvent({ type: "error", message: "AI 这次没看懂，换个句子再试一次吧" }),
        );
        controller.enqueue(toSseEvent({ type: "done" }));
      } catch (error) {
        const appError = toAppError(error);
        controller.enqueue(toSseEvent({ type: "error", message: appError.userMessage }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(outputStream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * 跑一轮流式生成，边解析边推送事件。
 * @returns 本轮成功解析出的事件数量
 */
async function streamOneAttempt(
  controller: ReadableStreamDefaultController<Uint8Array>,
  messages: CompletionMessage[],
  strict: boolean,
): Promise<number> {
  const upstreamStream = await createChatCompletionStream({
    messages,
    temperature: strict ? 0 : 0.3,
    maxTokens: CORRECTION_MAX_TOKENS,
  });

  let lineBuffer = "";
  let parsedCount = 0;

  for await (const chunk of streamTextDeltas(upstreamStream)) {
    lineBuffer += chunk;

    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseCorrectionLine(line);
      if (!event) {
        continue;
      }
      parsedCount += 1;
      controller.enqueue(toSseEvent(event));
    }
  }

  // 流结束时可能还有最后一行没有换行符
  const lastEvent = parseCorrectionLine(lineBuffer);
  if (lastEvent) {
    parsedCount += 1;
    controller.enqueue(toSseEvent(lastEvent));
  }

  return parsedCount;
}
