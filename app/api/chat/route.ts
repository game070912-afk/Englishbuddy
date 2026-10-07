import { createChatCompletionStream, streamTextDeltas, type CompletionMessage } from "@/lib/api/ai";
import { getCurrentUser } from "@/lib/api/auth";
import { AppError, toAppError } from "@/lib/api/errors";
import { buildTutorSystemPrompt } from "@/lib/api/prompts";
import { assertQuota } from "@/lib/api/usage-guard";
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
 * 注意不能给太小：万一「关闭思考」的参数没生效，模型会先思考再回答，
 * 上限太小会把额度全喂给思考过程，用户收到一个字都没有的空回复。
 * 2048 能兜住「思考 + 回答」的最坏情况；正常关掉思考后远用不满。
 */
const REPLY_MAX_TOKENS = 2048;

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
  const user = await getCurrentUser();

  try {
    // 匿名和登录都限：只限匿名的话，注册个小号就能整个绕过去
    await assertQuota(request, user?.id ?? null);
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
          let emitted = 0;
          for await (const text of streamTextDeltas(upstreamStream)) {
            emitted += 1;
            controller.enqueue(toSseEvent({ type: "delta", text }));
          }

          if (emitted === 0) {
            // 上游返回 200 但一个字都没吐：与其让用户盯着空气，
            // 不如明说「这次没生成出来」，引导他再发一次
            console.warn("[EnglishBuddy] 上游返回了空回复");
            controller.enqueue(
              toSseEvent({ type: "error", message: "AI 这次没说话，请再发一次试试" }),
            );
          } else {
            controller.enqueue(toSseEvent({ type: "done", reason: "stop" }));
          }
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
