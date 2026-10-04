import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_DRAFT,
  clearChatDraft,
  readChatDraft,
  writeChatDraft,
  type ChatDraft,
} from "@/lib/utils/chat-draft";

/** 造一个够用的 sessionStorage 替身 */
function createStorage() {
  const raw = new Map<string, string>();
  return {
    getItem: (key: string): string | null => raw.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      raw.set(key, value);
    },
    removeItem: (key: string): void => {
      raw.delete(key);
    },
    raw,
  };
}

/**
 * 把 window 换成带 sessionStorage 的假实现。
 * 测试环境是 node，本来没有 window，代码靠 `typeof window` 判断 SSR，
 * 所以这里要手动造一个出来。
 */
function stubStorage(storage: ReturnType<typeof createStorage>): void {
  vi.stubGlobal("window", { sessionStorage: storage });
}

function makeDraft(overrides: Partial<ChatDraft> = {}): ChatDraft {
  return {
    messages: [{ id: "m1", role: "user", content: "hello" }],
    input: "",
    topic: "面试",
    level: "intermediate",
    conversationId: null,
    ...overrides,
  };
}

const DRAFT_KEY = "englishbuddy:chat-draft";

describe("对话草稿暂存", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("服务端渲染（没有 window）时返回空草稿，不报错", () => {
    // 不 stub window，模拟 SSR
    expect(readChatDraft()).toEqual(EMPTY_DRAFT);
  });

  it("存储里没内容时返回空草稿", () => {
    stubStorage(createStorage());

    expect(readChatDraft()).toEqual(EMPTY_DRAFT);
  });

  it("写进去的草稿能原样读回来", () => {
    const storage = createStorage();
    stubStorage(storage);
    const draft = makeDraft({
      messages: [
        { id: "m1", role: "user", content: "I want to practice English" },
        { id: "m2", role: "assistant", content: "Sure! Let's talk about travel." },
      ],
      input: "还没发出去的半句话",
      conversationId: "conv-123",
    });

    writeChatDraft(draft);

    expect(readChatDraft()).toEqual(draft);
  });

  it("存储里不是合法 JSON 时返回空草稿，而不是抛错", () => {
    const storage = createStorage();
    storage.raw.set(DRAFT_KEY, "{坏掉的 JSON");
    stubStorage(storage);

    expect(readChatDraft()).toEqual(EMPTY_DRAFT);
  });

  it("消息结构不合法的那几条会被丢掉，剩下的照常恢复", () => {
    const storage = createStorage();
    storage.raw.set(
      DRAFT_KEY,
      JSON.stringify({
        messages: [
          { id: "ok", role: "user", content: "good" },
          { id: "no-role", role: "robot", content: "bad" },
          { id: 42, role: "user", content: "bad id" },
          null,
        ],
      }),
    );
    stubStorage(storage);

    const draft = readChatDraft();

    expect(draft.messages).toEqual([{ id: "ok", role: "user", content: "good" }]);
  });

  it("难度取值不认识时回落到默认难度", () => {
    const storage = createStorage();
    storage.raw.set(DRAFT_KEY, JSON.stringify({ level: "super-hard" }));
    stubStorage(storage);

    expect(readChatDraft().level).toBe("intermediate");
  });

  it("内容为空时直接删掉键，不留空对象占着存储", () => {
    const storage = createStorage();
    stubStorage(storage);

    writeChatDraft(makeDraft());
    expect(storage.raw.has(DRAFT_KEY)).toBe(true);

    writeChatDraft(EMPTY_DRAFT);
    expect(storage.raw.has(DRAFT_KEY)).toBe(false);
  });

  it("只要还有没发出去的输入，就算没有消息也会保留", () => {
    const storage = createStorage();
    stubStorage(storage);

    writeChatDraft(makeDraft({ messages: [], input: "打到一半的话" }));

    expect(storage.raw.has(DRAFT_KEY)).toBe(true);
  });

  it("clearChatDraft 能清掉已存的草稿", () => {
    const storage = createStorage();
    stubStorage(storage);
    writeChatDraft(makeDraft());

    clearChatDraft();

    expect(storage.raw.has(DRAFT_KEY)).toBe(false);
  });

  it("超长消息会被截断，避免异常数据撑爆存储", () => {
    const storage = createStorage();
    storage.raw.set(
      DRAFT_KEY,
      JSON.stringify({ messages: [{ id: "m1", role: "user", content: "a".repeat(50_000) }] }),
    );
    stubStorage(storage);

    expect(readChatDraft().messages[0].content.length).toBe(20_000);
  });

  it("写入时存储不可用（无痕模式）也不抛错", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {},
      },
    });

    expect(() => writeChatDraft(makeDraft())).not.toThrow();
  });
});
