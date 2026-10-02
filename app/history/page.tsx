import Link from "next/link";

import { getCurrentUser } from "@/lib/api/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata = { title: "历史对话 · EnglishBuddy" };

/** 会话 + 其中消息的最小展示结构 */
interface ConversationRow {
  id: string;
  topic: string;
  level: string;
  created_at: string;
  messages: Array<{ id: string; role: string; content: string }>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

/**
 * 历史对话列表。
 * 只查当前登录用户的数据——行级安全策略在数据库层再兜一次底。
 */
export default async function HistoryPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-semibold text-slate-900">历史对话</h1>
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          当前环境没有配置 Supabase，历史功能不可用。
        </p>
      </div>
    );
  }

  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-semibold text-slate-900">历史对话</h1>
        <p className="mt-4 text-sm text-slate-600">
          登录后才能看到自己的对话记录。{" "}
          <Link href="/login" className="text-indigo-500 transition hover:text-indigo-600">
            去登录 →
          </Link>
        </p>
      </div>
    );
  }

  const supabase = await createClient();

  let conversations: ConversationRow[] = [];
  let failed = false;

  if (supabase) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, topic, level, created_at, messages(id, role, content)")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("[EnglishBuddy] 读取历史会话失败：", error);
      failed = true;
    } else {
      conversations = (data ?? []) as unknown as ConversationRow[];
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold text-slate-900">历史对话</h1>
      <p className="mt-2 text-sm text-slate-500">最近 20 次练习记录，只属于你本人。</p>

      {failed ? (
        <p className="mt-6 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
          读取失败了，请稍后再试
        </p>
      ) : null}

      {!failed && conversations.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
          还没有记录，去 <Link href="/chat" className="text-indigo-500">对话练习</Link> 聊两句就会自动存下来
        </p>
      ) : null}

      <ul className="mt-6 space-y-4">
        {conversations.map((conversation) => {
          const firstUserMessage = conversation.messages?.find((item) => item.role === "user");
          const count = conversation.messages?.length ?? 0;

          return (
            <li key={conversation.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-indigo-50 px-2 py-1 text-indigo-600">
                  {conversation.topic}
                </span>
                <span>{formatDate(conversation.created_at)}</span>
                <span>· {count} 条消息</span>
              </div>

              {firstUserMessage ? (
                <p className="mt-3 line-clamp-2 text-sm text-slate-800">
                  {firstUserMessage.content}
                </p>
              ) : null}

              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-slate-500 transition hover:text-indigo-500">
                  展开完整对话
                </summary>
                <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  {conversation.messages?.map((message) => (
                    <p
                      key={message.id}
                      className={
                        message.role === "user"
                          ? "text-sm text-slate-800"
                          : "text-sm text-slate-600"
                      }
                    >
                      <span className="mr-2 text-xs text-slate-400">
                        {message.role === "user" ? "我" : "Alex"}
                      </span>
                      {message.content}
                    </p>
                  ))}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
