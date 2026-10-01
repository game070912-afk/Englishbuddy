/**
 * AI 思考中的打字动画，作为流式输出开始前的加载状态。
 */
export default function TypingIndicator() {
  return (
    <div className="flex w-full justify-start" aria-live="polite" aria-label="AI 正在回复">
      <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" />
      </div>
    </div>
  );
}
