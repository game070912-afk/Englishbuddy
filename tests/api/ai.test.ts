import { afterEach, describe, expect, it, vi } from "vitest";

import { createChatCompletionStream, resolveAiConfig } from "@/lib/api/ai";

/** 需要清理的环境变量，避免用例之间互相污染 */
const MANAGED_KEYS = [
  "AI_PROVIDER",
  "AI_BASE_URL",
  "AI_API_KEY",
  "AI_MODEL",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
] as const;

describe("resolveAiConfig", () => {
  afterEach(() => {
    for (const key of MANAGED_KEYS) {
      delete process.env[key];
    }
  });

  it("默认使用免费的智谱预设", () => {
    const config = resolveAiConfig();

    expect(config.provider).toBe("zhipu");
    expect(config.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(config.model).toBe("glm-4.7-flash");
  });

  it("指定 AI_PROVIDER=deepseek 时切换到 DeepSeek 预设", () => {
    process.env.AI_PROVIDER = "deepseek";

    const config = resolveAiConfig();

    expect(config.baseUrl).toBe("https://api.deepseek.com");
    expect(config.model).toBe("deepseek-v4-flash");
  });

  it("显式环境变量优先级高于预设", () => {
    process.env.AI_BASE_URL = "https://example.com/v1";
    process.env.AI_MODEL = "my-model";
    process.env.AI_API_KEY = "my-key";

    const config = resolveAiConfig();

    expect(config.baseUrl).toBe("https://example.com/v1");
    expect(config.model).toBe("my-model");
    expect(config.apiKey).toBe("my-key");
  });

  it("兼容旧的 DEEPSEEK_API_KEY 变量名", () => {
    process.env.DEEPSEEK_API_KEY = "legacy-key";

    expect(resolveAiConfig().apiKey).toBe("legacy-key");
  });

  it("只填旧的 DEEPSEEK_BASE_URL 时模型不跟着智谱预设走", () => {
    process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com";

    const config = resolveAiConfig();

    expect(config.provider).toBe("deepseek");
    expect(config.model).toBe("deepseek-v4-flash");
  });

  it("未知的 AI_PROVIDER 值回退到默认供应商", () => {
    process.env.AI_PROVIDER = "not-a-provider";

    expect(resolveAiConfig().provider).toBe("zhipu");
  });
});

/** 构造一段模拟的上游 SSE 响应体 */
function createFakeUpstreamStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const payload = JSON.stringify({ choices: [{ delta: { content: "Hi" } }] });
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

describe("createChatCompletionStream 的 thinking 参数处理", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AI_API_KEY;
    delete process.env.AI_PROVIDER;
  });

  it("智谱供应商下会关闭思考，避免思考吃光 token 额度", async () => {
    process.env.AI_API_KEY = "test-key";
    let sentBody = "";
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBody = String(init?.body);
      return new Response(createFakeUpstreamStream());
    });
    vi.stubGlobal("fetch", fetchMock);

    await createChatCompletionStream({ messages: [{ role: "user", content: "hi" }] });

    const body = JSON.parse(sentBody) as { thinking?: { type?: string } };
    expect(body.thinking?.type).toBe("disabled");
  });

  it("其他供应商不带 thinking 参数", async () => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_PROVIDER = "deepseek";
    let sentBody = "";
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBody = String(init?.body);
      return new Response(createFakeUpstreamStream());
    });
    vi.stubGlobal("fetch", fetchMock);

    await createChatCompletionStream({ messages: [{ role: "user", content: "hi" }] });

    const body = JSON.parse(sentBody) as { thinking?: unknown };
    expect(body.thinking).toBeUndefined();
  });

  it("上游不认识 thinking 参数（400）时自动去掉重试", async () => {
    process.env.AI_API_KEY = "test-key";
    const bodies: string[] = [];
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const raw = String(init?.body);
      if (bodies.length === 0) {
        bodies.push(raw);
        return new Response("bad request", { status: 400 });
      }
      bodies.push(raw);
      return new Response(createFakeUpstreamStream());
    });
    vi.stubGlobal("fetch", fetchMock);

    const stream = await createChatCompletionStream({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(stream).toBeInstanceOf(ReadableStream);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(bodies[0] ?? "{}") as { thinking?: unknown };
    const second = JSON.parse(bodies[1] ?? "{}") as { thinking?: unknown };
    expect(first.thinking).toBeDefined();
    expect(second.thinking).toBeUndefined();
  });
});
