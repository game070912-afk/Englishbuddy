import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertAsrConfigured,
  parseTranscriptionPayload,
  resolveAsrConfig,
  transcribeWav,
} from "@/lib/api/asr";

/** 需要清理的环境变量，避免用例之间互相污染 */
const MANAGED_KEYS = ["ASR_API_KEY", "ASR_BASE_URL", "AI_FALLBACK_API_KEY"] as const;

function clearManagedKeys(): void {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }
}

describe("resolveAsrConfig", () => {
  afterEach(clearManagedKeys);

  it("未配置时读出空字符串", () => {
    expect(resolveAsrConfig()).toEqual({ apiKey: "", baseUrl: "https://api.groq.com/openai/v1" });
  });

  it("读取环境变量并去掉首尾空格", () => {
    process.env.ASR_API_KEY = "  key  ";

    expect(resolveAsrConfig().apiKey).toBe("key");
  });

  it("没配 ASR 专用密钥时回落到备用 AI 的 Groq Key", () => {
    process.env.AI_FALLBACK_API_KEY = "gsk_fallback";

    expect(resolveAsrConfig().apiKey).toBe("gsk_fallback");
  });

  it("专用密钥优先于备用 AI 的 Key", () => {
    process.env.ASR_API_KEY = "asr-key";
    process.env.AI_FALLBACK_API_KEY = "gsk_fallback";

    expect(resolveAsrConfig().apiKey).toBe("asr-key");
  });

  it("可以覆盖接口地址", () => {
    process.env.ASR_BASE_URL = "https://example.com/v1";

    expect(resolveAsrConfig().baseUrl).toBe("https://example.com/v1");
  });
});

describe("assertAsrConfigured", () => {
  afterEach(clearManagedKeys);

  it("缺密钥时抛出未配置错误", () => {
    expect(() => assertAsrConfigured()).toThrow("语音识别还没配置好");
  });

  it("只要有一条可用密钥就不报错", () => {
    process.env.AI_FALLBACK_API_KEY = "gsk_fallback";

    expect(() => assertAsrConfigured()).not.toThrow();
  });
});

describe("parseTranscriptionPayload", () => {
  it("正常结果里取出文本", () => {
    expect(parseTranscriptionPayload({ text: "hello world" })).toBe("hello world");
  });

  it("文本两侧的空白被去掉", () => {
    expect(parseTranscriptionPayload({ text: "  hi  " })).toBe("hi");
  });

  it("识别成功但没有内容时提示没听清", () => {
    expect(() => parseTranscriptionPayload({ text: "   " })).toThrow("没听清");
    expect(() => parseTranscriptionPayload({ text: "" })).toThrow("没听清");
  });

  it("响应体缺 text 字段时给出通用提示", () => {
    expect(() => parseTranscriptionPayload({})).toThrow("再试一次");
    expect(() => parseTranscriptionPayload({ wrong: 1 })).toThrow("再试一次");
  });

  it("响应体不是对象时给出通用提示", () => {
    expect(() => parseTranscriptionPayload(null)).toThrow("再试一次");
    expect(() => parseTranscriptionPayload("boom")).toThrow("再试一次");
  });
});

describe("transcribeWav", () => {
  beforeEach(() => {
    clearManagedKeys();
    process.env.ASR_API_KEY = "key";
  });

  afterEach(clearManagedKeys);

  it("未配置密钥时直接拒绝，不发网络请求", async () => {
    delete process.env.ASR_API_KEY;

    await expect(transcribeWav("AAQC")).rejects.toThrow("语音识别还没配置好");
  });

  it("非 base64 内容被挡在发请求之前", async () => {
    await expect(transcribeWav("not base64!")).rejects.toThrow("录音格式不正确");
  });

  it("超过 60 秒的录音被挡在发请求之前", async () => {
    // 60 秒 16k/16bit 单声道 base64 约 256 万字符，这里稍微超一点
    await expect(transcribeWav("A".repeat(2_600_000))).rejects.toThrow("60 秒");
  });
});
