import type { ChatRole } from "@/lib/types/chat";

interface ChatBubbleProps {
  /** 发送方 */
  role: ChatRole;
  /** 消息正文 */
  content: string;
}

/**
 * 单条对话气泡。
 * 内容以文本节点渲染，由 React 自动转义，不使用 innerHTML。
 */
export default function ChatBubble({ role, content }: ChatBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words",
          isUser ? "bg-indigo-500 text-white" : "bg-white text-slate-800 border border-slate-200",
        ].join(" ")}
      >
        {content}
      </div>
    </div>
  );
}
