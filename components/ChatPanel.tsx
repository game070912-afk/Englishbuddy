"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import ChatBubble from "@/components/ChatBubble";
import ChatInput from "@/components/ChatInput";
import TypingIndicator from "@/components/TypingIndicator";
import type { ChatMessage, ChatStreamEvent, EnglishLevel } from "@/lib/types/chat";
import { createClient } from "@/lib/supabase/client";
import { readChatDraft, writeChatDraft } from "@/lib/utils/chat-draft";

/** 难度选项 */
const LEVEL_OPTIONS: ReadonlyArray<{ value: EnglishLevel; label: string }> = [
  { value: "beginner", label: "入门" },
  { value: "intermediate", label: "进阶" },
  { value: "advanced", label: "高阶" },
];

/** 运行时校验 SSE 事件结构 */
function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return type === "delta" || type === "done" || type === "error";
}

/** 从错误响应中取出中文提示 */
function extractErrorMessage(payload: unknown): string {
  if (typeof payload === "object" && payload !== null) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "object" && error !== null) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") {
        return message;
      }
    }
  }
  return "请求失败了，请稍后再试";
}

/** 创建消息 id，兼容不支持 randomUUID 的环境 */
function createId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * 是否已经完成客户端水合。
 *
 * 服务端渲染时页面上还什么都没有，而客户端一恢复草稿就有内容了，
 * 直接渲染会让两边 HTML 对不上（hydration 不一致）。所以先用服务端口径渲染，
 * 水合完成后再切到真实内容——整个过程只有一帧，肉眼看不出来。
 *
 * 用 `useSyncExternalStore` 而不是「useEffect 里 setState」，是因为后者属于
 * 级联渲染（ESLint 直接报错），而前者本来就是为「服务端快照 vs 客户端快照」
 * 这种场景设计的。
 */
function subscribeToNothing(): () => void {
  return () => {};
}

function getClientSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * 对话主面板：负责消息状态、流式接收 AI 回复与错误处理。
 *
 * 状态分成两层：
 * - 对话内容（messages / topic / level / 输入框）会暂存到 sessionStorage，
 *   这样在 /chat 与 /history 之间来回跳、或者刷新页面，内容都还在；
 * - 一次性的界面状态（是否在加载、报错提示）不暂存，回到页面就是干净的状态。
 *
 * @param voiceEnabled 服务端是否配好了语音识别；没配就不显示麦克风按钮
 */
export default function ChatPanel({ voiceEnabled = false }: { voiceEnabled?: boolean }) {
  const hydrated = useSyncExternalStore(subscribeToNothing, getClientSnapshot, getServerSnapshot);

  /**
   * 首次渲染时读一次本地草稿，作为下面各状态的初始值。
   * 用 useState 惰性初始化而不是 useRef，是因为在渲染期间读写 ref
   * 会被 ESLint 的 react-hooks/refs 拦下来。
   */
  const [draft] = useState(readChatDraft);

  const [messages, setMessages] = useState<ChatMessage[]>(draft.messages);
  const [input, setInput] = useState(draft.input);
  const [topic, setTopic] = useState(draft.topic);
  const [level, setLevel] = useState<EnglishLevel>(draft.level);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  /** 是否已登录；只有登录后才自动保存 */
  const [signedIn, setSignedIn] = useState(false);
  /** 当前会话在数据库里的 id，第一次保存后才有 */
  const [conversationId, setConversationId] = useState<string | null>(draft.conversationId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  /**
   * 把对话内容暂存到本地，这样切到别的页面再回来内容还在。
   *
   * 流式回复期间先不写：AI 是一个字一个字吐的，每个字都序列化一遍整段对话
   * 太浪费，等这一轮结束（isLoading 变回 false）再存一次就够了。
   */
  useEffect(() => {
    if (isLoading) {
      return;
    }
    writeChatDraft({ messages, input, topic, level, conversationId });
  }, [messages, input, topic, level, conversationId, isLoading]);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      return;
    }

    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) {
        setSignedIn(Boolean(data.user));
      }
    });

    return () => {
      active = false;
    };
  }, []);

  /** 把这一轮对话存下来；失败也不打断聊天 */
  async function saveConversation(finalMessages: ChatMessage[]): Promise<void> {
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(conversationId ? { id: conversationId } : {}),
          topic: topic.trim() || undefined,
          level,
          messages: finalMessages,
        }),
      });

      if (!response.ok) {
        return;
      }

      const payload: unknown = await response.json().catch(() => null);
      const id = (payload as { id?: unknown } | null)?.id;
      if (typeof id === "string" && id) {
        setConversationId(id);
      }
    } catch {
      // 保存失败静默处理，不影响对话体验
    }
  }

  /**
   * 语音识别的结果回填到输入框，而不是直接发出去。
   * 转写难免有错，让用户先看一眼、改完再发送。
   */
  function handleTranscribed(text: string): void {
    setError(null);
    setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
  }

  async function handleSend(): Promise<void> {
    const content = input.trim();
    if (!content || isLoading) {
      return;
    }

    const userMessage: ChatMessage = { id: createId(), role: "user", content };
    const history = [...messages, userMessage];

    setMessages(history);
    setInput("");
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          topic: topic.trim() || undefined,
          level,
        }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setError(extractErrorMessage(payload));
        // 这一句没发出去：撤回气泡并把原文还回输入框，别让用户白打一遍
        setMessages(messages);
        setInput(content);
        return;
      }

      if (!response.body) {
        setError("没有收到 AI 的回复，请再试一次");
        setMessages(messages);
        setInput(content);
        return;
      }

      const assistantId = createId();
      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

      const reply = await readStream(response.body, assistantId);

      if (signedIn && reply.trim()) {
        void saveConversation([...history, { id: assistantId, role: "assistant", content: reply }]);
      }
    } catch {
      setError("网络不太稳定，请检查网络后重试");
      setMessages(messages);
      setInput(content);
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * 逐段读取 SSE 流并追加到对应消息。
   * @returns AI 最终回复的完整文本，供保存对话使用
   */
  async function readStream(stream: ReadableStream<Uint8Array>, assistantId: string): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";

    const appendText = (text: string): void => {
      accumulated += text;
      setMessages((prev) =>
        prev.map((item) => (item.id === assistantId ? { ...item, content: accumulated } : item)),
      );
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const payload = line.trim();
        if (!payload.startsWith("data:")) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(payload.slice(5).trim());
        } catch {
          continue;
        }

        if (!isChatStreamEvent(parsed)) {
          continue;
        }

        if (parsed.type === "delta") {
          appendText(parsed.text);
        } else if (parsed.type === "error") {
          setError(parsed.message);
        }
      }
    }

    reader.releaseLock();
    return accumulated;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            话题
            <input
              value={hydrated ? topic : ""}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="如：面试、旅行"
              className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-indigo-500"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            难度
            <select
              value={hydrated ? level : "intermediate"}
              onChange={(event) => setLevel(event.target.value as EnglishLevel)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-indigo-500"
            >
              {LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {/* 水合完成前一律按「空对话」渲染，才能和服务端的 HTML 对上 */}
          {!hydrated || messages.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
              设定一个话题，直接用英语打招呼就能开始练习 ✨
            </p>
          ) : null}

          {hydrated
            ? messages.map((message) => (
                <ChatBubble key={message.id} role={message.role} content={message.content} />
              ))
            : null}

          {hydrated && isLoading && messages[messages.length - 1]?.content === "" ? (
            <TypingIndicator />
          ) : null}

          {hydrated && error ? (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      <ChatInput
        value={hydrated ? input : ""}
        onChange={setInput}
        onSend={handleSend}
        disabled={isLoading}
        onTranscribed={voiceEnabled ? handleTranscribed : undefined}
        onVoiceError={setError}
      />
    </div>
  );
}
