import { createChatCompletionStream, streamTextDeltas, type CompletionMessage } from "@/lib/api/ai";
import { getCurrentUser } from "@/lib/api/auth";
import { AppError, toAppError } from "@/lib/api/errors";
import { buildTutorSystemPrompt } from "@/lib/api/prompts";
import { assertAnonymousQuota } from "@/lib/api/usage-guard";
import type { ChatRequestBody, ChatErrorResponse, ChatStreamEvent } from "@/lib/types/chat";
import { parseChatRequestBody, trimMessagesByBudget } from "@/lib/utils/validate";

/** 部署到 Vercel 时允许的最长执行时间（流式回复需要） */
export const maxDuration = 60;

/** 事件流的编码工具 */
const encoder = new TextEncoder();
/** 匿名访客最多携带的历史消息条数 */
const ANONYMOUS_HISTORY_LIMIT = 6;
/** 历史消息的总字符预算：超出就从最旧的开始丢，保证输入不会越聊越胖 */
const HISTORY_CHAR_BUDGET = 4000;
/**
 * 单次回复的生成上限。
 * 外教被要求每次只说 2-4 句（约 100 token），给 320 留足余量；
 * 真正起的作用是防止模型偶尔发疯写长文，让用户干等十几秒。
 */
const REPLY_MAX_TOKENS = 320;

/** 把事件序列化为 SSE 格式 */
function toSseEvent(event: ChatStreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** 构造统一的错误响应（中文提示 + 错误码） */
function buildErrorResponse(error: AppError): Response {
  const payload: ChatErrorResponse = {
    error: { message: error.userMessage, code: error.code },
  };
  return new Response(JSON.stringify(payload), {
    status: error.status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * POST /api/chat
 * 请求体：{ messages: ChatMessage[], topic?: string, level?: EnglishLevel }
 * 响应：text/event-stream，事件结构见 ChatStreamEvent
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

  let body: ChatRequestBody;

  try {
    const raw: unknown = await request.json();
    body = parseChatRequestBody(raw);
  } catch {
    return buildErrorResponse(new AppError("请求内容格式不正确", "INVALID_REQUEST", 400));
  }

  // 匿名访客只带最近 6 条上下文，控制单次调用成本
  if (!user && body.messages.length > ANONYMOUS_HISTORY_LIMIT) {
    body = { ...body, messages: body.messages.slice(-ANONYMOUS_HISTORY_LIMIT) };
  }

  // 再按字符数兜一道：输入越短，模型吐第一个字之前的等待越短
  body = { ...body, messages: trimMessagesByBudget(body.messages, HISTORY_CHAR_BUDGET) };

  const messages: CompletionMessage[] = [
    { role: "system", content: buildTutorSystemPrompt(body.topic, body.level) },
    ...body.messages.map((item) => ({ role: item.role, content: item.content })),
  ];

  try {
    const upstreamStream = await createChatCompletionStream({
      messages,
      maxTokens: REPLY_MAX_TOKENS,
    });

    const outputStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const text of streamTextDeltas(upstreamStream)) {
            controller.enqueue(toSseEvent({ type: "delta", text }));
          }
          controller.enqueue(toSseEvent({ type: "done", reason: "stop" }));
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
  } catch (error) {
    return buildErrorResponse(toAppError(error));
  }
}
