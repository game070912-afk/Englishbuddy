import ChatPanel from "@/components/ChatPanel";

export const metadata = {
  title: "对话练习 · EnglishBuddy",
};

/**
 * 对话练习页：挂着客户端组件 ChatPanel，流式交互在其内部完成。
 */
export default function ChatPage() {
  return <ChatPanel />;
}
