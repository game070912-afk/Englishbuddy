"use client";

import { MAX_MESSAGE_LENGTH } from "@/lib/utils/validate";

interface ChatInputProps {
  /** 当前输入内容 */
  value: string;
  /** 输入变化回调 */
  onChange: (value: string) => void;
  /** 发送回调 */
  onSend: () => void;
  /** 是否处于加载中（禁用输入） */
  disabled: boolean;
}

/**
 * 对话输入框：Enter 发送、Shift+Enter 换行，超出长度时提示。
 */
export default function ChatInput({ value, onChange, onSend, disabled }: ChatInputProps) {
  const isOverLimit = value.length > MAX_MESSAGE_LENGTH;
  const canSend = value.trim().length > 0 && !disabled && !isOverLimit;

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) {
        onSend();
      }
    }
  }

  return (
    <div className="border-t border-slate-200 bg-white p-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {isOverLimit ? (
          <p className="text-xs text-red-500">
            输入超出 {MAX_MESSAGE_LENGTH} 字，请精简后再发送
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            maxLength={MAX_MESSAGE_LENGTH + 200}
            placeholder="用英语和外教聊聊，Enter 发送 / Shift+Enter 换行"
            className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-500 disabled:bg-slate-50"
            disabled={disabled}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
