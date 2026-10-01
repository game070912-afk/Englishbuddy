import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/correct/route";
import type { CorrectionErrorResponse } from "@/lib/types/correction";

/** 构造一段模拟的 DeepSeek SSE 响应体 */
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

/** 构造一个发送到 /api/correct 的请求 */
function createRequest(body: unknown): Request {
  return new Request("http://localhost/api/correct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** 读取整个 SSE 响应并合并成文本 */
async function readAll(response: Response): Promise<string> {
  return await response.text();
}

describe("POST /api/correct", () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("缺少 text 字段时返回 400", async () => {
    const response = await POST(createRequest({}));

    expect(response.status).toBe(400);
    const payload = (await response.json()) as CorrectionErrorResponse;
    expect(payload.error.code).toBe("INVALID_REQUEST");
  });

  it("请求体不是合法 JSON 时返回 400", async () => {
    const response = await POST(createRequest("not-a-json"));

    expect(response.status).toBe(400);
  });

  it("正常返回修正文本与纠错条目", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          createFakeUpstreamStream([
            '{"kind":"corrected","text":"I want to practice."}\n',
            '{"kind":"item","original":"I wants","suggestion":"I want","type":"grammar","explanation":"主语 I 后接动词原形"}\n',
          ]),
        ),
      ),
    );

    const response = await POST(createRequest({ text: "I wants to practice." }));

    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await readAll(response);
    expect(text).toContain('"type":"corrected"');
    expect(text).toContain("I want to practice.");
    expect(text).toContain('"type":"item"');
    expect(text).toContain('"type":"done"');
  });

  it("模型输出完全无法解析时重试一次并返回友好提示", async () => {
    const fetchMock = vi.fn(async () => new Response(createFakeUpstreamStream(["嗯，我看不懂这段英文。"])));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(createRequest({ text: "some text" }));

    const text = await readAll(response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(text).toContain('"type":"error"');
  });

  it("未配置密钥时返回中文错误提示", async () => {
    delete process.env.DEEPSEEK_API_KEY;

    const response = await POST(createRequest({ text: "I wants to practice." }));

    expect(response.status).toBe(500);
    const payload = (await response.json()) as CorrectionErrorResponse;
    expect(payload.error.code).toBe("AI_NOT_CONFIGURED");
  });
});
