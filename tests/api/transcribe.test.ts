import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/transcribe/route";
import { resetAsrTokenCache } from "@/lib/api/asr";
import type { TranscribeErrorResponse, TranscribeResponse } from "@/lib/types/transcribe";

/** 构造一个发往 /api/transcribe 的请求 */
function createRequest(body: unknown): Request {
  return new Request("http://localhost/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** 同时模拟百度的鉴权与识别两个接口 */
function stubBaidu(result: unknown, tokenStatus = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      if (String(url).includes("aip.baidubce.com")) {
        return new Response(JSON.stringify({ access_token: "token", expires_in: 2592000 }), {
          status: tokenStatus,
        });
      }
      return new Response(JSON.stringify(result), { status: 200 });
    }),
  );
}

describe("POST /api/transcribe", () => {
  beforeEach(() => {
    resetAsrTokenCache();
    process.env.BAIDU_ASR_API_KEY = "key";
    process.env.BAIDU_ASR_SECRET_KEY = "secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BAIDU_ASR_API_KEY;
    delete process.env.BAIDU_ASR_SECRET_KEY;
  });

  it("未配置密钥时返回 501 与中文提示", async () => {
    delete process.env.BAIDU_ASR_API_KEY;

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
    stubBaidu({ err_no: 0, result: ["I want to practice English"] });

    const response = await POST(createRequest({ audio: "AAQC" }));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as TranscribeResponse;
    expect(payload.text).toBe("I want to practice English");
  });

  it("上游没听清时返回友好提示，而不是原始响应", async () => {
    stubBaidu({ err_no: 3301, err_msg: "speech quality error" });

    const response = await POST(createRequest({ audio: "AAQC" }));

    expect(response.status).toBe(502);
    const payload = (await response.json()) as TranscribeErrorResponse;
    expect(payload.error.code).toBe("ASR_UPSTREAM_ERROR");
    expect(payload.error.message).toContain("没听清");
  });

  it("发给百度的请求里带上了英文模型与 16k 采样率", async () => {
    let sentBody: BodyInit | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url).includes("aip.baidubce.com")) {
          return new Response(JSON.stringify({ access_token: "token", expires_in: 2592000 }));
        }
        sentBody = init?.body;
        return new Response(JSON.stringify({ err_no: 0, result: ["hi"] }));
      }),
    );

    await POST(createRequest({ audio: "AAQC" }));

    const body = JSON.parse(String(sentBody)) as { dev_pid?: number; rate?: number; format?: string };
    // 1737 = 英文模型；16000 = 百度要求的采样率
    expect(body.dev_pid).toBe(1737);
    expect(body.rate).toBe(16000);
    expect(body.format).toBe("wav");
  });
});
