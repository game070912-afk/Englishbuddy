"use client";

import { useState } from "react";

import TypingIndicator from "@/components/TypingIndicator";
import type {
  CorrectionItem,
  CorrectionStreamEvent,
  CorrectionType,
} from "@/lib/types/correction";
import { MAX_MESSAGE_LENGTH } from "@/lib/utils/validate";

/** 错误类型对应的中文标签 */
const TYPE_LABELS: Record<CorrectionType, string> = {
  grammar: "语法",
  word: "用词",
  style: "风格",
  expression: "表达",
};

/** 运行时校验 SSE 事件结构 */
function isCorrectionStreamEvent(value: unknown): value is CorrectionStreamEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return type === "corrected" || type === "item" || type === "done" || type === "error";
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

/**
 * 语法纠错面板：提交英文段落，流式接收批改结果。
 */
export default function CorrectPanel() {
  const [text, setText] = useState("");
  const [corrected, setCorrected] = useState("");
  const [items, setItems] = useState<CorrectionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = text.trim().length > 0 && !isLoading && text.length <= MAX_MESSAGE_LENGTH;

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) {
      return;
    }

    setIsLoading(true);
    setCorrected("");
    setItems([]);
    setError(null);

    try {
      const response = await fetch("/api/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setError(extractErrorMessage(payload));
        return;
      }

      if (!response.body) {
        setError("没有收到批改结果，请再试一次");
        return;
      }

      await readStream(response.body);
    } catch {
      setError("网络不太稳定，请检查网络后重试");
    } finally {
      setIsLoading(false);
    }
  }

  /** 逐行读取 SSE 流并更新结果 */
  async function readStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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

        if (!isCorrectionStreamEvent(parsed)) {
          continue;
        }

        if (parsed.type === "corrected") {
          setCorrected(parsed.text);
        } else if (parsed.type === "item") {
          setItems((prev) => [...prev, parsed.item]);
        } else if (parsed.type === "error") {
          setError(parsed.message);
        }
      }
    }

    reader.releaseLock();
  }

  const showSkeleton = isLoading && corrected === "" && items.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-2">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={5}
          maxLength={MAX_MESSAGE_LENGTH + 200}
          placeholder="粘贴或写一段英文，例如：I wants to practice my English every day."
          className="w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-500"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {text.length}/{MAX_MESSAGE_LENGTH}
          </span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            开始批改
          </button>
        </div>
      </div>

      {showSkeleton ? (
        <div className="flex flex-col gap-2">
          <div className="h-16 animate-pulse rounded-xl bg-slate-200" />
          <TypingIndicator />
        </div>
      ) : null}

      {corrected ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">修改后的文本</h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">
            {corrected}
          </p>
        </section>
      ) : null}

      {items.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-900">批改意见（{items.length}）</h2>
          {items.map((item, index) => (
            <article key={`${item.original}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4">
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-500">
                {TYPE_LABELS[item.type]}
              </span>
              <p className="mt-2 text-sm text-slate-500 line-through">{item.original}</p>
              <p className="text-sm font-medium text-emerald-600">{item.suggestion}</p>
              {item.explanation ? (
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{item.explanation}</p>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      {error ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
