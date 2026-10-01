import CorrectPanel from "@/components/CorrectPanel";

export const metadata = {
  title: "语法纠错 · EnglishBuddy",
};

/**
 * 语法纠错页：挂着客户端组件 CorrectPanel，流式批改在其内部完成。
 */
export default function CorrectPage() {
  return <CorrectPanel />;
}
