import { afterEach, describe, expect, it, vi } from "vitest";

import { realtimeOptions } from "@/lib/supabase/realtime";

/**
 * 这几个用例守的是一次真实线上事故：
 * EdgeOne Makers 的函数运行时是 Node 20，没有全局 WebSocket，
 * 而 supabase-js 创建客户端时会立刻去找 WebSocket，找不到就 throw，
 * 中间件一挂整站 500。所以「没有原生 WebSocket 也必须给出 transport」必须长期成立。
 */
describe("realtimeOptions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("有原生 WebSocket 时直接用原生的", () => {
    class FakeWebSocket {}
    vi.stubGlobal("WebSocket", FakeWebSocket);

    expect(realtimeOptions().realtime.transport).toBe(FakeWebSocket);
  });

  it("没有原生 WebSocket 时退回占位实现，而不是抛错", () => {
    vi.stubGlobal("WebSocket", undefined);

    expect(() => realtimeOptions()).not.toThrow();
    expect(realtimeOptions().realtime.transport).toBeTypeOf("function");
  });

  it("占位实现能被 new 出来并记住地址", () => {
    vi.stubGlobal("WebSocket", undefined);

    interface TransportLike {
      url: string;
    }
    const Transport = realtimeOptions().realtime.transport as unknown as new (url: string) => TransportLike;
    const instance = new Transport("wss://example.com/realtime");

    expect(instance.url).toBe("wss://example.com/realtime");
  });
});
