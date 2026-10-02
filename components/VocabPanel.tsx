"use client";

import { useState } from "react";

import type { VocabCard, VocabDraft, VocabListResponse } from "@/lib/types/vocab";

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

/** 统一处理响应：不 ok 就抛出中文错误 */
async function readJsonOrThrow<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(extractErrorMessage(payload));
  }

  return payload as T;
}

/**
 * 生词本面板：查词生成卡片、保存进生词本、删除卡片。
 * @param initialCards 服务端预取的卡片列表
 * @param signedIn 是否已登录；未登录只能查词不能保存
 */
export default function VocabPanel({
  initialCards,
  signedIn,
}: {
  initialCards: VocabCard[];
  signedIn: boolean;
}) {
  const [word, setWord] = useState("");
  const [context, setContext] = useState("");
  const [cards, setCards] = useState<VocabCard[]>(initialCards);
  const [result, setResult] = useState<VocabDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const [duplicated, setDuplicated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 重新拉取生词本，保存后用它保证列表和数据库一致 */
  async function refreshCards(): Promise<void> {
    try {
      const response = await fetch("/api/vocab", { method: "GET" });
      const payload = await readJsonOrThrow<VocabListResponse>(response);
      setCards(payload.cards ?? []);
    } catch {
      // 列表刷新失败不打断主流程，下次打开页面会重新拉
    }
  }

  async function handleLookup(): Promise<void> {
    const trimmed = word.trim();
    if (!trimmed || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);
    setSaved(false);
    setDuplicated(false);

    try {
      const response = await fetch("/api/vocab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: trimmed, context: context.trim() || undefined }),
      });

      const payload = await readJsonOrThrow<{
        card: VocabDraft;
        saved: boolean;
        duplicated: boolean;
      }>(response);

      setResult(payload.card);
      if (payload.saved) {
        setSaved(true);
        setDuplicated(payload.duplicated);
        void refreshCards();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "请求失败了，请稍后再试");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (!result || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/vocab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: result.word,
          // 把刚生成的卡片一起带回去，服务端直接入库，不用再让 AI 算一遍
          card: result,
          context: context.trim() || result.context || undefined,
          save: true,
        }),
      });

      const payload = await readJsonOrThrow<{ saved: boolean; duplicated: boolean }>(response);
      setSaved(payload.saved);
      setDuplicated(payload.duplicated);
      await refreshCards();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败了，请稍后再试");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    try {
      const response = await fetch(`/api/vocab/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setError(extractErrorMessage(payload));
        return;
      }
      setCards((prev) => prev.filter((item) => item.id !== id));
      // 删掉的词可以从卡片区重新收藏
      setSaved(false);
      setDuplicated(false);
    } catch {
      setError("删除失败了，请稍后再试");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={word}
            onChange={(event) => setWord(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handleLookup();
              }
            }}
            placeholder="输入单词，如 negotiate"
            className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={() => void handleLookup()}
            disabled={isLoading || !word.trim()}
            className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "生成中…" : "生成卡片"}
          </button>
        </div>

        <input
          value={context}
          onChange={(event) => setContext(event.target.value)}
          placeholder="选填：你遇到这个词的原句，带上它释义更准"
          className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />

        {error ? (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600" role="alert">
            {error}
          </p>
        ) : null}

        {result ? (
          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-lg font-semibold text-slate-900">{result.word}</h2>
              {result.phonetic ? (
                <span className="text-sm text-slate-500">{result.phonetic}</span>
              ) : null}
            </div>

            {result.definition ? (
              <p className="mt-2 text-sm text-slate-800">{result.definition}</p>
            ) : null}

            {result.example_sentence ? (
              <p className="mt-2 text-sm italic text-slate-600">{result.example_sentence}</p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {signedIn ? (
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isLoading || saved}
                  className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saved ? "已收藏 ✓" : "加入生词本"}
                </button>
              ) : (
                <span className="text-xs text-slate-500">登录后可把卡片存进生词本</span>
              )}

              {duplicated ? (
                <span className="text-xs text-slate-500">生词本里已经有这个词了</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-900">我的生词本（{cards.length}）</h2>

        {cards.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
            还没有收藏，查一个词试试 ✨
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {cards.map((card) => (
              <li
                key={card.id}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold text-slate-900">{card.word}</span>
                    {card.phonetic ? (
                      <span className="text-xs text-slate-500">{card.phonetic}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(card.id)}
                    className="shrink-0 text-xs text-slate-400 transition hover:text-rose-500"
                  >
                    删除
                  </button>
                </div>

                {card.definition ? (
                  <p className="mt-2 text-sm text-slate-800">{card.definition}</p>
                ) : null}
                {card.example_sentence ? (
                  <p className="mt-1 text-sm italic text-slate-600">{card.example_sentence}</p>
                ) : null}
                {card.context ? (
                  <p className="mt-2 text-xs text-slate-400">来源：{card.context}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
