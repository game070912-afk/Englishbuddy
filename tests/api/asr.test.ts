import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertAsrConfigured, parseAsrPayload, resolveAsrConfig, resetAsrTokenCache, transcribeWav } from "@/lib/api/asr";

/** 需要清理的环境变量，避免用例之间互相污染 */
const MANAGED_KEYS = ["BAIDU_ASR_API_KEY", "BAIDU_ASR_SECRET_KEY"] as const;

describe("resolveAsrConfig", () => {
  afterEach(() => {
    for (const key of MANAGED_KEYS) {
      delete process.env[key];
    }
  });

  it("未配置时读出空字符串", () => {
    expect(resolveAsrConfig()).toEqual({ apiKey: "", secretKey: "" });
  });

  it("读取环境变量并去掉首尾空格", () => {
    process.env.BAIDU_ASR_API_KEY = "  key  ";
    process.env.BAIDU_ASR_SECRET_KEY = " secret ";

    expect(resolveAsrConfig()).toEqual({ apiKey: "key", secretKey: "secret" });
  });
});

describe("assertAsrConfigured", () => {
  afterEach(() => {
    for (const key of MANAGED_KEYS) {
      delete process.env[key];
    }
  });

  it("缺密钥时抛出未配置错误", () => {
    expect(() => assertAsrConfigured()).toThrow("语音识别还没配置好");
  });

  it("只填了一半也当作没配", () => {
    process.env.BAIDU_ASR_API_KEY = "key";

    expect(() => assertAsrConfigured()).toThrow("语音识别还没配置好");
  });

  it("两条都填了就不报错", () => {
    process.env.BAIDU_ASR_API_KEY = "key";
    process.env.BAIDU_ASR_SECRET_KEY = "secret";

    expect(() => assertAsrConfigured()).not.toThrow();
  });
});

describe("parseAsrPayload", () => {
  it("正常结果里取出文本", () => {
    expect(parseAsrPayload({ err_no: 0, result: ["hello world"] })).toBe("hello world");
  });

  it("多段结果拼成一句话", () => {
    expect(parseAsrPayload({ err_no: 0, result: ["hello", "world"] })).toBe("hello world");
  });

  it("识别成功但没有内容时提示没听清", () => {
    expect(() => parseAsrPayload({ err_no: 0, result: [] })).toThrow("没听清");
    expect(() => parseAsrPayload({ err_no: 0 })).toThrow("没听清");
  });

  it("把百度的错误码翻译成人话", () => {
    expect(() => parseAsrPayload({ err_no: 3301 })).toThrow("没听清");
    expect(() => parseAsrPayload({ err_no: 3302 })).toThrow("密钥");
    expect(() => parseAsrPayload({ err_no: 3308 })).toThrow("60 秒");
    expect(() => parseAsrPayload({ err_no: 9999 })).toThrow("再试一次");
  });

  it("响应体不是对象时给出通用提示", () => {
    expect(() => parseAsrPayload(null)).toThrow("再试一次");
    expect(() => parseAsrPayload("boom")).toThrow("再试一次");
  });
});

describe("transcribeWav", () => {
  beforeEach(() => {
    resetAsrTokenCache();
    process.env.BAIDU_ASR_API_KEY = "key";
    process.env.BAIDU_ASR_SECRET_KEY = "secret";
  });

  afterEach(() => {
    for (const key of MANAGED_KEYS) {
      delete process.env[key];
    }
  });

  it("未配置密钥时直接拒绝，不发网络请求", async () => {
    delete process.env.BAIDU_ASR_API_KEY;

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
