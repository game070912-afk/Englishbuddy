import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/api/errors";
import { assertQuota } from "@/lib/api/usage-guard";

/**
 * 这一组测的是**数据库用不了时的内存兜底**。
 * 把 Supabase 关掉（没配），限流就退回进程内计数——逻辑仍然要成立。
 *
 * 注意：限流用的是模块级 Map，测试之间会共享。
 * 所以每个用例都用**不同的 IP / 用户 ID**，避免互相干扰。
 */
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => false,
  SUPABASE_URL: "",
  SUPABASE_PUBLISHABLE_KEY: "",
}));

/** 造一个带指定来源 IP 的请求 */
function requestFrom(ip: string): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

/** 连续调用 n 次，全部应当放行 */
async function callTimes(request: Request, userId: string | null, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await assertQuota(request, userId);
  }
}

describe("assertQuota（内存兜底）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("匿名访客 20 次之内放行，第 21 次报 429", async () => {
    const request = requestFrom("10.1.1.1");

    await callTimes(request, null, 20);
    await expect(assertQuota(request, null)).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      userMessage: expect.stringContaining("登录"),
    });
  });

  it("登录用户 60 次之内放行，第 61 次报 429", async () => {
    const request = requestFrom("10.2.2.2");

    await callTimes(request, "user-a", 60);
    await expect(assertQuota(request, "user-a")).rejects.toMatchObject({
      status: 429,
      userMessage: expect.stringContaining("频繁"),
    });
  });

  it("登录用户的额度比匿名高——只限匿名挡不住注册小号", async () => {
    const request = requestFrom("10.3.3.3");
    await callTimes(request, null, 20);
    await expect(assertQuota(request, null)).rejects.toBeInstanceOf(AppError);

    await expect(assertQuota(request, "user-b")).resolves.toBeUndefined();
  });

  it("不同 IP 各算各的", async () => {
    await callTimes(requestFrom("10.4.4.4"), null, 20);
    await expect(assertQuota(requestFrom("10.4.4.4"), null)).rejects.toBeInstanceOf(AppError);

    await expect(assertQuota(requestFrom("10.4.4.5"), null)).resolves.toBeUndefined();
  });

  it("不同用户各算各的", async () => {
    const request = requestFrom("10.5.5.5");
    await callTimes(request, "user-c", 60);
    await expect(assertQuota(request, "user-c")).rejects.toBeInstanceOf(AppError);

    await expect(assertQuota(request, "user-d")).resolves.toBeUndefined();
  });

  it("窗口过期后额度重置", async () => {
    vi.useFakeTimers();
    const request = requestFrom("10.6.6.6");

    await callTimes(request, null, 20);
    await expect(assertQuota(request, null)).rejects.toBeInstanceOf(AppError);

    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1000);
    await expect(assertQuota(request, null)).resolves.toBeUndefined();
  });
});
