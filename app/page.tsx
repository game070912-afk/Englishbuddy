import Link from "next/link";

/** 首页展示的功能卡片 */
const FEATURES: ReadonlyArray<{ title: string; description: string; available: boolean }> = [
  {
    title: "英语对话练习",
    description: "模拟外教实时对话，可指定话题与难度，回复流式呈现。",
    available: true,
  },
  {
    title: "语法与表达纠错",
    description: "标注错误类型并给出更地道的说法，支持整段批改。",
    available: true,
  },
  {
    title: "词汇卡片",
    description: "结合上下文生成释义与例句，一键收藏成学习卡片。",
    available: false,
  },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold text-slate-900">EnglishBuddy</h1>
        <p className="text-base leading-relaxed text-slate-600">
          你的 AI 英语陪练：随时开口说，说错了当场纠正。
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Link
            href="/chat"
            className="w-fit rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-600"
          >
            开始对话练习
          </Link>
          <Link
            href="/correct"
            className="w-fit rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:border-indigo-500 hover:text-indigo-500"
          >
            批改一段英文
          </Link>
        </div>
      </section>

      <section className="mt-10 grid gap-4 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">{feature.title}</h2>
              {feature.available ? (
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-500">
                  可用
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  开发中
                </span>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">{feature.description}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
