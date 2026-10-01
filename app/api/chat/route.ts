import { createChatCompletionStream, streamTextDeltas, type CompletionMessage } from "@/lib/api/ai";
import { AppError, toAppError } from "@/lib/api/errors";
import { buildTutorSystemPrompt } from "@/lib/api/prompts";
import type { ChatRequestBody, ChatErrorResponse, ChatStreamEvent } from "@/lib/types/chat";
import { parseChatRequestBody } from "@/lib/utils/validate";

/** 部署到 Vercel 时允许的最长执行时间（流式回复需要） */
export const maxDuration = 60;

/** 事件流的编码工具 */
const encoder = new TextEncoder();

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
  let body: ChatRequestBody;

  try {
    const raw: unknown = await request.json();
    body = parseChatRequestBody(raw);
  } catch {
    return buildErrorResponse(new AppError("请求内容格式不正确", "INVALID_REQUEST", 400));
  }

  const messages: CompletionMessage[] = [
    { role: "system", content: buildTutorSystemPrompt(body.topic, body.level) },
    ...body.messages.map((item) => ({ role: item.role, content: item.content })),
  ];

  try {
    const upstreamStream = await createChatCompletionStream({ messages });

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
