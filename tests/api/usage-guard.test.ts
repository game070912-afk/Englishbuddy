import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/api/errors";
import { assertQuota } from "@/lib/api/usage-guard";

/**
 * 注意：限流用的是模块级 Map，测试之间会共享。
 * 所以每个用例都用**不同的 IP / 用户 ID**，避免互相干扰。
 */

/** 造一个带指定来源 IP 的请求 */
function requestFrom(ip: string): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

/** 连续调用 n 次，全部应当放行 */
function callTimes(request: Request, userId: string | null, times: number): void {
  for (let i = 0; i < times; i += 1) {
    assertQuota(request, userId);
  }
}

describe("assertQuota", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("匿名访客 20 次之内放行，第 21 次报 429", () => {
    const request = requestFrom("10.1.1.1");

    expect(() => callTimes(request, null, 20)).not.toThrow();

    try {
      assertQuota(request, null);
      expect.unreachable("第 21 次应该被拦下");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.status).toBe(429);
      expect(appError.code).toBe("RATE_LIMITED");
      expect(appError.userMessage).toContain("登录");
    }
  });

  it("登录用户 60 次之内放行，第 61 次报 429", () => {
    const request = requestFrom("10.2.2.2");

    expect(() => callTimes(request, "user-a", 60)).not.toThrow();

    try {
      assertQuota(request, "user-a");
      expect.unreachable("第 61 次应该被拦下");
    } catch (error) {
      const appError = error as AppError;
      expect(appError.status).toBe(429);
      expect(appError.userMessage).toContain("频繁");
    }
  });

  it("登录用户的额度比匿名高——只限匿名挡不住注册小号", () => {
    // 同一个来源：匿名被拦之后，登录用户仍能继续用
    const request = requestFrom("10.3.3.3");
    callTimes(request, null, 20);
    expect(() => assertQuota(request, null)).toThrow(AppError);

    expect(() => assertQuota(request, "user-b")).not.toThrow();
  });

  it("不同 IP 各算各的", () => {
    callTimes(requestFrom("10.4.4.4"), null, 20);
    expect(() => assertQuota(requestFrom("10.4.4.4"), null)).toThrow(AppError);

    expect(() => assertQuota(requestFrom("10.4.4.5"), null)).not.toThrow();
  });

  it("不同用户各算各的", () => {
    const request = requestFrom("10.5.5.5");
    callTimes(request, "user-c", 60);
    expect(() => assertQuota(request, "user-c")).toThrow(AppError);

    expect(() => assertQuota(request, "user-d")).not.toThrow();
  });

  it("窗口过期后额度重置", () => {
    vi.useFakeTimers();
    const request = requestFrom("10.6.6.6");

    callTimes(request, null, 20);
    expect(() => assertQuota(request, null)).toThrow(AppError);

    // 快进过 10 分钟窗口
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1000);
    expect(() => assertQuota(request, null)).not.toThrow();
  });
});
