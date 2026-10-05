import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/transcribe/route";
import type { TranscribeErrorResponse, TranscribeResponse } from "@/lib/types/transcribe";

/** 构造一个发往 /api/transcribe 的请求 */
function createRequest(body: unknown): Request {
  return new Request("http://localhost/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/**
 * 模拟 Groq 的 Whisper 识别接口，记录发出去的表单以便断言。
 * 注意：调用方必须持有返回的 state 对象再读 sentForm，
 * 不能直接解构——mock 是在请求发出之后才写入的。
 */
function stubWhisper(result: unknown): { sentForm: FormData | null } {
  const state: { sentForm: FormData | null } = { sentForm: null };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = init?.body as FormData | null | undefined;
      // 不用 instanceof：vitest 与被测模块的 FormData 可能来自不同的类
      if (body && typeof body.get === "function") {
        state.sentForm = body;
      }
      return new Response(JSON.stringify(result), { status: 200 });
    }),
  );

  return state;
}

describe("POST /api/transcribe", () => {
  beforeEach(() => {
    process.env.ASR_API_KEY = "key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ASR_API_KEY;
  });

  it("未配置密钥时返回 501 与中文提示", async () => {
    delete process.env.ASR_API_KEY;

    const response = await POST(createRequest({ audio: "AAQC" }));

    expect(response.status).toBe(501);
    const payload = (await response.json()) as TranscribeErrorResponse;
    expect(payload.error.code).toBe("ASR_NOT_CONFIGURED");
  });

  it("请求体不是合法 JSON 时返回 400", async () => {
    const response = await POST(createRequest("not-a-json"));

    expect(response.status).toBe(400);
  });

  it("缺少 audio 字段时返回 400", async () => {
    const response = await POST(createRequest({ text: "hello" }));

    expect(response.status).toBe(400);
    const payload = (await response.json()) as TranscribeErrorResponse;
    expect(payload.error.message).toContain("没有收到录音");
  });

  it("audio 不是 base64 时返回 400", async () => {
    const response = await POST(createRequest({ audio: "hello world!" }));

    expect(response.status).toBe(400);
    const payload = (await response.json()) as TranscribeErrorResponse;
    expect(payload.error.message).toContain("格式");
  });

  it("录音超过 60 秒时返回 400", async () => {
    const response = await POST(createRequest({ audio: "A".repeat(2_700_000) }));

    expect(response.status).toBe(400);
    const payload = (await response.json()) as TranscribeErrorResponse;
    expect(payload.error.message).toContain("60 秒");
  });

  it("正常录音返回识别出的文本", async () => {
    stubWhisper({ text: "I want to practice English" });

    const response = await POST(createRequest({ audio: "AAQC" }));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as TranscribeResponse;
    expect(payload.text).toBe("I want to practice English");
  });

  it("上游没听清时返回友好提示，而不是原始响应", async () => {
    stubWhisper({ text: "   " });

    const response = await POST(createRequest({ audio: "AAQC" }));

    expect(response.status).toBe(502);
    const payload = (await response.json()) as TranscribeErrorResponse;
    expect(payload.error.code).toBe("ASR_UPSTREAM_ERROR");
    expect(payload.error.message).toContain("没听清");
  });

  it("发给 Whisper 的表单里带上了英文语言与音频文件", async () => {
    const state = stubWhisper({ text: "hi" });

    await POST(createRequest({ audio: "AAQC" }));

    expect(state.sentForm).not.toBeNull();
    expect(state.sentForm?.get("model")).toBe("whisper-large-v3");
    expect(state.sentForm?.get("language")).toBe("en");
    expect((state.sentForm?.get("file") as File | null)?.name).toBe("audio.wav");
  });
});
