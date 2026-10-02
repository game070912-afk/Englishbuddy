import { requireUser } from "@/lib/api/auth";
import { AppError, toAppError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { VocabErrorResponse } from "@/lib/types/vocab";

/** uuid 的基本形状校验，挡掉明显不合法的 id */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildErrorResponse(error: AppError): Response {
  const payload: VocabErrorResponse = {
    error: { message: error.userMessage, code: error.code },
  };
  return new Response(JSON.stringify(payload), {
    status: error.status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * DELETE /api/vocab/[id]
 * 删除一张自己的生词卡片。
 * 删除条件里带上 user_id，即使行级安全策略哪天被改坏，也删不掉别人的数据。
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    if (!isSupabaseConfigured()) {
      throw new AppError("还没配置 Supabase，生词本不可用", "AI_NOT_CONFIGURED", 501);
    }

    const user = await requireUser();
    if (!user) {
      throw new AppError("请先登录", "UNAUTHORIZED", 401);
    }

    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) {
      throw new AppError("卡片编号不正确", "INVALID_REQUEST", 400);
    }

    const supabase = await createClient();
    if (!supabase) {
      throw new AppError("还没配置 Supabase，生词本不可用", "AI_NOT_CONFIGURED", 501);
    }

    const { error } = await supabase.from("vocab_cards").delete().eq("id", id).eq("user_id", user.id);

    if (error) {
      console.error("[EnglishBuddy] 删除生词卡片失败：", error);
      throw new AppError("删除失败了，请稍后再试", "INTERNAL_ERROR", 500);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return buildErrorResponse(toAppError(error));
  }
}
