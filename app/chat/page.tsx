import ChatPanel from "@/components/ChatPanel";
import { isAsrConfigured } from "@/lib/api/asr";

export const metadata = {
  title: "对话练习 · EnglishBuddy",
};

/**
 * 对话练习页：挂着客户端组件 ChatPanel，流式交互在其内部完成。
 *
 * 语音识别是否配置好在服务端判断，没配就不渲染麦克风按钮——
 * 比让用户点一下才发现用不了体面得多。
 */
export default function ChatPage() {
  return <ChatPanel voiceEnabled={isAsrConfigured()} />;
}
