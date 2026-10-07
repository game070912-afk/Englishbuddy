import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertQuota } from "@/lib/api/usage-guard";

/**
 * 这一组测的是**数据库计数**（线上真正生效的那条路径）。
 * 内存计数在 EdgeOne 上实测完全失效（每次请求都是独立实例），所以这条路径才是关键。
 */

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => true,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "key",
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: rpcMock }),
}));

function requestFrom(ip: string): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

describe("assertQuota（数据库计数）", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: true, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("数据库说放行就不拦", async () => {
    await expect(assertQuota(requestFrom("20.0.0.1"), null)).resolves.toBeUndefined();
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("数据库说超限就报 429，且不再走内存", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });

    await expect(assertQuota(requestFrom("20.0.0.2"), null)).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      userMessage: expect.stringContaining("登录"),
    });
  });

  it("匿名按 IP 计数，额度 20；登录按用户计数，额度 60", async () => {
    await assertQuota(requestFrom("20.0.0.3"), null);
    expect(rpcMock).toHaveBeenLastCalledWith("consume_api_quota", {
      p_key: "ip:20.0.0.3",
      p_window_ms: 10 * 60 * 1000,
      p_max: 20,
    });

    await assertQuota(requestFrom("20.0.0.3"), "user-x");
    expect(rpcMock).toHaveBeenLastCalledWith("consume_api_quota", {
      p_key: "user:user-x",
      p_window_ms: 10 * 60 * 1000,
      p_max: 60,
    });
  });

  it("数据库报错时降级放行——限流不能把站搞挂", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(assertQuota(requestFrom("20.0.0.4"), null)).resolves.toBeUndefined();
  });

  it("数据库直接抛异常时也降级放行", async () => {
    rpcMock.mockRejectedValue(new Error("网络断了"));

    await expect(assertQuota(requestFrom("20.0.0.5"), null)).resolves.toBeUndefined();
  });
});
