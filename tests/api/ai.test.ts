import { afterEach, describe, expect, it } from "vitest";

import { resolveAiConfig } from "@/lib/api/ai";

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
