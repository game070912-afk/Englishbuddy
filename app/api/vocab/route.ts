import {
  assertAiConfigured,
  createChatCompletionStream,
  streamTextDeltas,
  type CompletionMessage,
} from "@/lib/api/ai";
import { getCurrentUser, requireUser } from "@/lib/api/auth";
import { AppError, toAppError } from "@/lib/api/errors";
import { buildVocabSystemPrompt, buildVocabUserPrompt } from "@/lib/api/prompts";
import { assertQuota } from "@/lib/api/usage-guard";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type {
  VocabDraft,
  VocabErrorResponse,
  VocabListResponse,
  VocabResponse,
  VocabCard,
} from "@/lib/types/vocab";
import { parseVocabDraft } from "@/lib/utils/vocab";
import { MAX_WORD_LENGTH, sanitizeUserText } from "@/lib/utils/validate";

/** 生成卡片允许的最长执行时间 */
export const maxDuration = 60;

/** 上下文原句的最大字符数 */
const MAX_CONTEXT_LENGTH = 300;
/** 生词本一次最多返回多少张卡片 */
const LIST_LIMIT = 100;
/** 最多重试一次 */
const MAX_ATTEMPTS = 2;
/** 卡片不长，但上限给足余量：模型若先思考再输出，小的上限会导致空回复解析失败 */
const CARD_MAX_TOKENS = 1024;

/** 构造统一的错误响应 */
function buildErrorResponse(error: AppError): Response {
  const payload: VocabErrorResponse = {
    error: { message: error.userMessage, code: error.code },
  };
  return new Response(JSON.stringify(payload), {
    status: error.status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function buildJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** 校验查词请求体，顺带做长度与非法字符清洗 */
function parseRequestBody(raw: unknown): { word: string; context: string; save: boolean } {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("请求内容格式不正确", "INVALID_REQUEST", 400);
  }

  const candidate = raw as Record<string, unknown>;

  if (typeof candidate.word !== "string" || !candidate.word.trim()) {
    throw new AppError("请先输入要查询的单词", "INVALID_REQUEST", 400);
  }

  return {
    word: sanitizeUserText(candidate.word, MAX_WORD_LENGTH),
    context:
      typeof candidate.context === "string"
        ? sanitizeUserText(candidate.context, MAX_CONTEXT_LENGTH)
        : "",
    save: candidate.save === true,
  };
}

/**
 * 取出客户端捎回来的卡片。
 * 客户端数据不可信，所以走一遍和 AI 输出完全相同的解析与清洗，不合法就当没带。
 */
function parseProvidedCard(raw: unknown): VocabDraft | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const card = (raw as Record<string, unknown>).card;
  if (typeof card !== "object" || card === null) {
    return null;
  }

  return parseVocabDraft(JSON.stringify(card));
}

/** 跑一轮生成，把上游流拼成完整文本 */
async function generateOnce(messages: CompletionMessage[], temperature: number): Promise<string> {
  const stream = await createChatCompletionStream({
    messages,
    temperature,
    maxTokens: CARD_MAX_TOKENS,
  });
  let text = "";

  for await (const chunk of streamTextDeltas(stream)) {
    text += chunk;
  }

  return text;
}

/** 生成一张卡片；第一次不成就用更严格的参数再试一次 */
async function generateCard(word: string, context: string): Promise<VocabDraft> {
  const messages: CompletionMessage[] = [
    { role: "system", content: buildVocabSystemPrompt() },
    { role: "user", content: buildVocabUserPrompt(word, context) },
  ];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const raw = await generateOnce(messages, attempt === MAX_ATTEMPTS ? 0 : 0.3);
    const card = parseVocabDraft(raw);
    if (card) {
      return card;
    }
  }

  // 解析不出来就把原文留在日志里方便排查，用户只看到一句人话
  throw new AppError("AI 这次没生成出卡片，换个词再试一次吧", "AI_STREAM_ERROR", 502);
}

/**
 * POST /api/vocab
 * 生成一个单词卡片；登录且 save=true 时顺手存进生词本。
 * 匿名可以试用，但走限额；已登录用户不受限。
 */
export async function POST(request: Request): Promise<Response> {
  let card: VocabDraft | null = null;
  let saved = false;
  let duplicated = false;

  try {
    const user = await getCurrentUser();

    // 匿名和登录都限：只限匿名的话，注册个小号就能整个绕过去
    assertQuota(request, user?.id ?? null);

    // request.json() 遇到非 JSON 会抛 SyntaxError，单独接住转成 400
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new AppError("请求内容格式不正确", "INVALID_REQUEST", 400);
    }

    const body = parseRequestBody(raw);

    if (body.save && !user) {
      throw new AppError("登录后才能把卡片存进生词本", "UNAUTHORIZED", 401);
    }

    // 客户端把生成好的卡片带回来了，直接入库，不再调一次 AI
    const provided = parseProvidedCard(raw);
    if (provided) {
      card = provided;
    } else {
      // 开跑之前先确认配置就绪，避免让用户白等一轮
      assertAiConfigured();
      card = await generateCard(body.word, body.context);
    }

    if (body.save && user) {
      const supabase = await createClient();
      if (!supabase) {
        throw new AppError("还没配置 Supabase，暂时无法保存", "AI_NOT_CONFIGURED", 501);
      }

      // 同一个词不重复存，避免生词本里堆一堆一样的。
      // 这里用 eq 而不是 ilike：ilike 会把用户输入里的 % 和 _ 当通配符，
      // 一个「%」就能匹配到任意卡片，去重就失效了。
      const { data: existing } = await supabase
        .from("vocab_cards")
        .select("id")
        .eq("user_id", user.id)
        .eq("word", card.word)
        .maybeSingle();

      if (existing) {
        saved = true;
        duplicated = true;
      } else {
        const { error } = await supabase.from("vocab_cards").insert({
          user_id: user.id,
          word: card.word,
          phonetic: card.phonetic,
          definition: card.definition,
          example_sentence: card.example_sentence,
          context: card.context || body.context || null,
        });

        if (error) {
          console.error("[EnglishBuddy] 保存生词卡片失败：", error);
          throw new AppError("卡片没存进去，请稍后再试", "INTERNAL_ERROR", 500);
        }

        saved = true;
      }
    }

    const payload: VocabResponse = { card, saved, duplicated };
    return buildJsonResponse(payload);
  } catch (error) {
    return buildErrorResponse(toAppError(error));
  }
}

/**
 * GET /api/vocab
 * 列出当前登录用户的生词卡片。数据隔离由行级安全策略兜底。
 */
export async function GET(): Promise<Response> {
  try {
    if (!isSupabaseConfigured()) {
      throw new AppError("还没配置 Supabase，生词本不可用", "AI_NOT_CONFIGURED", 501);
    }

    const user = await requireUser();
    if (!user) {
      throw new AppError("请先登录", "UNAUTHORIZED", 401);
    }

    const supabase = await createClient();
    if (!supabase) {
      throw new AppError("还没配置 Supabase，生词本不可用", "AI_NOT_CONFIGURED", 501);
    }

    const { data, error } = await supabase
      .from("vocab_cards")
      .select("id, word, phonetic, definition, example_sentence, context, created_at")
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);

    if (error) {
      console.error("[EnglishBuddy] 读取生词本失败：", error);
      throw new AppError("生词本读取失败，请稍后再试", "INTERNAL_ERROR", 500);
    }

    const payload: VocabListResponse = { cards: (data ?? []) as unknown as VocabCard[] };
    return buildJsonResponse(payload);
  } catch (error) {
    return buildErrorResponse(toAppError(error));
  }
}
