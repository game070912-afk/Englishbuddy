import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/chat/route";
import type { ChatErrorResponse } from "@/lib/types/chat";

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

/** 构造一个发送到 /api/chat 的请求 */
function createRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    process.env.AI_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AI_API_KEY;
  });

  it("未配置密钥时返回中文错误提示", async () => {
    delete process.env.AI_API_KEY;

    const response = await POST(
      createRequest({ messages: [{ id: "1", role: "user", content: "hello" }] }),
    );

    expect(response.status).toBe(500);
    const payload = (await response.json()) as ChatErrorResponse;
    expect(payload.error.code).toBe("AI_NOT_CONFIGURED");
    expect(payload.error.message).toContain("AI 服务");
  });

  it("请求体不是合法 JSON 时返回 400", async () => {
    const response = await POST(createRequest("not-a-json"));

    expect(response.status).toBe(400);
    const payload = (await response.json()) as ChatErrorResponse;
    expect(payload.error.code).toBe("INVALID_REQUEST");
  });

  it("缺少 messages 字段时返回 400", async () => {
    const response = await POST(createRequest({ topic: "面试" }));

    expect(response.status).toBe(400);
  });

  it("正常请求时以 SSE 形式流式返回增量文本", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(createFakeUpstreamStream(["Hello", " world"]))),
    );

    const response = await POST(
      createRequest({ messages: [{ id: "1", role: "user", content: "hi" }], level: "beginner" }),
    );

    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await response.text();
    expect(text).toContain("Hello");
    expect(text).toContain("world");
    expect(text).toContain('"type":"done"');
  });

  it("给上游的请求里带上了生成长度上限，避免模型啰嗦拖慢回复", async () => {
    // 拦下真正发出去的请求体，确认长度上限没有漏掉
    let sentBody: BodyInit | null | undefined;
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBody = init?.body;
      return new Response(createFakeUpstreamStream(["Hi"]));
    });
    vi.stubGlobal("fetch", fetchMock);

    await POST(createRequest({ messages: [{ id: "1", role: "user", content: "hi" }] }));

    const body = JSON.parse(String(sentBody)) as { max_tokens?: number };
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it("上游接口异常时返回友好提示而不是原始响应", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));

    const response = await POST(
      createRequest({ messages: [{ id: "1", role: "user", content: "hi" }] }),
    );

    expect(response.status).toBe(502);
    const payload = (await response.json()) as ChatErrorResponse;
    expect(payload.error.code).toBe("AI_UPSTREAM_ERROR");
  });
});
