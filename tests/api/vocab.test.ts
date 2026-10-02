import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST, GET } from "@/app/api/vocab/route";
import { DELETE } from "@/app/api/vocab/[id]/route";
import type { VocabErrorResponse, VocabResponse } from "@/lib/types/vocab";

/** 构造一段模拟的上游 SSE 响应体 */
function createFakeUpstreamStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        const payload = JSON.stringify({ choices: [{ delta: { content: chunk } }] });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function createRequest(body: unknown): Request {
  return new Request("http://localhost/api/vocab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID_CARD = JSON.stringify({
  word: "negotiate",
  phonetic: "/nɪˈɡəʊʃieɪt/",
  definition: "谈判，协商",
  example_sentence: "We need to negotiate the price.",
  context: "",
});

describe("POST /api/vocab", () => {
  beforeEach(() => {
    process.env.AI_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AI_API_KEY;
  });

  it("未配置密钥时返回中文错误提示", async () => {
    delete process.env.AI_API_KEY;

    const response = await POST(createRequest({ word: "hello" }));

    expect(response.status).toBe(500);
    const payload = (await response.json()) as VocabErrorResponse;
    expect(payload.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("请求体不是合法 JSON 时返回 400", async () => {
    const response = await POST(createRequest("not-a-json"));

    expect(response.status).toBe(400);
    const payload = (await response.json()) as VocabErrorResponse;
    expect(payload.error.code).toBe("INVALID_REQUEST");
  });

  it("缺少 word 字段时返回 400", async () => {
    const response = await POST(createRequest({ context: "hello world" }));

    expect(response.status).toBe(400);
  });

  it("未登录却要求保存时返回 401", async () => {
    const response = await POST(createRequest({ word: "hello", save: true }));

    expect(response.status).toBe(401);
    const payload = (await response.json()) as VocabErrorResponse;
    expect(payload.error.code).toBe("UNAUTHORIZED");
  });

  it("正常请求时返回解析好的卡片", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(createFakeUpstreamStream([VALID_CARD]))),
    );

    const response = await POST(createRequest({ word: "negotiate" }));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as VocabResponse;
    expect(payload.card.word).toBe("negotiate");
    expect(payload.card.definition).toBe("谈判，协商");
    expect(payload.saved).toBe(false);
  });

  it("客户端捎回已生成的卡片时不再调用 AI", async () => {
    const fetchMock = vi.fn(async () => new Response(createFakeUpstreamStream([VALID_CARD])));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      createRequest({ word: "negotiate", card: { word: "brave", definition: "勇敢的" } }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    const payload = (await response.json()) as VocabResponse;
    expect(payload.card.word).toBe("brave");
  });

  it("客户端塞来的非法卡片会被忽略，仍然重新生成", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(createFakeUpstreamStream([VALID_CARD]))),
    );

    // 缺 word 的卡片属于非法数据，不能因为客户端说它有就信
    const response = await POST(
      createRequest({ word: "negotiate", card: { definition: "没有单词" } }),
    );

    const payload = (await response.json()) as VocabResponse;
    expect(payload.card.word).toBe("negotiate");
  });

  it("AI 输出无法解析时返回友好提示而不是 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(createFakeUpstreamStream(["抱歉，我帮不上忙"]))),
    );

    const response = await POST(createRequest({ word: "negotiate" }));

    expect(response.status).toBe(502);
    const payload = (await response.json()) as VocabErrorResponse;
    expect(payload.error.message).toContain("换个词");
  });
});

describe("GET /api/vocab 与 DELETE /api/vocab/[id]", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  });

  it("未配置 Supabase 时列表接口返回 501 而不是 500", async () => {
    const response = await GET();

    expect(response.status).toBe(501);
    const payload = (await response.json()) as VocabErrorResponse;
    expect(payload.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("未配置 Supabase 时删除接口返回 501", async () => {
    const response = await DELETE(new Request("http://localhost/api/vocab/x"), {
      params: Promise.resolve({ id: "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8" }),
    });

    expect(response.status).toBe(501);
  });

  it("删除时用的是动态路由参数，能正确取出卡片 id", async () => {
    // 这里只验证参数能被 await 出来：未配置 Supabase 时会在校验之后立刻返回 501，
    // 说明 params 的 Promise 结构没写错（写错会在取参数时抛异常）
    const response = await DELETE(new Request("http://localhost/api/vocab/x"), {
      params: Promise.resolve({ id: "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8" }),
    });

    expect(response.status).toBe(501);
    const payload = (await response.json()) as VocabErrorResponse;
    expect(payload.error.code).toBe("AI_NOT_CONFIGURED");
  });
});
