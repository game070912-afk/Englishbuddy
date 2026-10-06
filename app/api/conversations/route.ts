import { AppError, toAppError } from "@/lib/api/errors";
import { requireUser } from "@/lib/api/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { assertQuota } from "@/lib/api/usage-guard";
import { MAX_MESSAGE_LENGTH, MAX_TOPIC_LENGTH, sanitizeUserText } from "@/lib/utils/validate";

/** 一次最多保存的消息条数，防止超大请求 */
const MAX_SAVE_MESSAGES = 60;

interface SaveRequestBody {
  /** 已有会话 id；不传则新建会话 */
  id?: string;
  topic?: string;
  level?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

function buildErrorResponse(error: AppError): Response {
  return new Response(JSON.stringify({ error: { message: error.userMessage, code: error.code } }), {
    status: error.status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** 运行时校验保存请求，顺带做长度与非法字符清洗 */
function parseSaveRequestBody(raw: unknown): SaveRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("请求内容格式不正确", "INVALID_REQUEST", 400);
  }

  const candidate = raw as Record<string, unknown>;

  if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) {
    throw new AppError("没有可保存的对话内容", "INVALID_REQUEST", 400);
  }

  const messages = candidate.messages
    .filter((item): item is { role: "user" | "assistant"; content: string } => {
      if (typeof item !== "object" || item === null) {
        return false;
      }
      const record = item as Record<string, unknown>;
      return (
        (record.role === "user" || record.role === "assistant") &&
        typeof record.content === "string" &&
        record.content.trim().length > 0
      );
    })
    .slice(-MAX_SAVE_MESSAGES)
    .map((item) => ({
      role: item.role,
      content: sanitizeUserText(item.content, MAX_MESSAGE_LENGTH),
    }))
    .filter((item) => item.content.length > 0);

  if (messages.length === 0) {
    throw new AppError("对话内容为空", "INVALID_REQUEST", 400);
  }

  const result: SaveRequestBody = { messages };

  if (typeof candidate.id === "string" && candidate.id.trim()) {
    result.id = candidate.id.trim();
  }
  if (typeof candidate.topic === "string") {
    const topic = sanitizeUserText(candidate.topic, MAX_TOPIC_LENGTH);
    if (topic) {
      result.topic = topic;
    }
  }
  if (typeof candidate.level === "string") {
    result.level = candidate.level;
  }

  return result;
}

/**
 * POST /api/conversations
 * 保存一轮对话：带 id 就往已有会话追加，没有就新建。
 * 必须登录；数据隔离由数据库的行级安全策略保证。
 */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!isSupabaseConfigured()) {
      throw new AppError("还没配置 Supabase，暂时无法保存", "AI_NOT_CONFIGURED", 501);
    }

    const user = await requireUser();
    if (!user) {
      throw new AppError("请先登录", "UNAUTHORIZED", 401);
    }

    // 这个接口不烧 AI 额度，但会写数据库，同样挡一道防刷
    assertQuota(request, user.id);

    const raw: unknown = await request.json();
    const body = parseSaveRequestBody(raw);

    const supabase = await createClient();
    if (!supabase) {
      throw new AppError("还没配置 Supabase，暂时无法保存", "AI_NOT_CONFIGURED", 501);
    }

    let conversationId = body.id;

    if (conversationId) {
      // 先确认这个会话确实属于当前用户，避免越权追加
      const { data: owned, error: ownedError } = await supabase
        .from("conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (ownedError || !owned) {
        throw new AppError("找不到这个会话", "INVALID_REQUEST", 404);
      }
    } else {
      const { data: created, error: createError } = await supabase
        .from("conversations")
        .insert({
          user_id: user.id,
          topic: body.topic ?? "日常交流",
          level: body.level ?? "intermediate",
        })
        .select("id")
        .single();

      if (createError || !created) {
        console.error("[EnglishBuddy] 创建会话失败：", createError);
        throw new AppError("保存失败了，请稍后再试", "INTERNAL_ERROR", 500);
      }

      conversationId = created.id as string;
    }

    const { error: insertError } = await supabase.from("messages").insert(
      body.messages.map((item) => ({
        conversation_id: conversationId,
        role: item.role,
        content: item.content,
      })),
    );

    if (insertError) {
      console.error("[EnglishBuddy] 保存消息失败：", insertError);
      throw new AppError("保存失败了，请稍后再试", "INTERNAL_ERROR", 500);
    }

    return new Response(JSON.stringify({ id: conversationId }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return buildErrorResponse(toAppError(error));
  }
}
