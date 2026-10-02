"use client";

import { useEffect, useRef, useState } from "react";

import ChatBubble from "@/components/ChatBubble";
import ChatInput from "@/components/ChatInput";
import TypingIndicator from "@/components/TypingIndicator";
import type { ChatMessage, ChatStreamEvent, EnglishLevel } from "@/lib/types/chat";
import { createClient } from "@/lib/supabase/client";

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
 * 对话主面板：负责消息状态、流式接收 AI 回复与错误处理。
 */
export default function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState<EnglishLevel>("intermediate");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  /** 是否已登录；只有登录后才自动保存 */
  const [signedIn, setSignedIn] = useState(false);
  /** 当前会话在数据库里的 id，第一次保存后才有 */
  const [conversationId, setConversationId] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

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
        return;
      }

      if (!response.body) {
        setError("没有收到 AI 的回复，请再试一次");
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
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="如：面试、旅行"
              className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-indigo-500"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            难度
            <select
              value={level}
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
          {messages.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
              设定一个话题，直接用英语打招呼就能开始练习 ✨
            </p>
          ) : null}

          {messages.map((message) => (
            <ChatBubble key={message.id} role={message.role} content={message.content} />
          ))}

          {isLoading && messages[messages.length - 1]?.content === "" ? <TypingIndicator /> : null}

          {error ? (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      <ChatInput value={input} onChange={setInput} onSend={handleSend} disabled={isLoading} />
    </div>
  );
}
