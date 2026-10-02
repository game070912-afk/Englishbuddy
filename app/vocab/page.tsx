import Link from "next/link";

import VocabPanel from "@/components/VocabPanel";
import { getCurrentUser } from "@/lib/api/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { VocabCard } from "@/lib/types/vocab";

export const metadata = { title: "生词本 · EnglishBuddy" };

/**
 * 查词与生词本页面。
 * 服务端先把已有卡片取出来，避免客户端先闪一下空列表。
 */
export default async function VocabPage() {
  const configured = isSupabaseConfigured();
  const user = configured ? await getCurrentUser() : null;

  let cards: VocabCard[] = [];

  if (user) {
    const supabase = await createClient();

    if (supabase) {
      const { data, error } = await supabase
        .from("vocab_cards")
        .select("id, word, phonetic, definition, example_sentence, context, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        console.error("[EnglishBuddy] 读取生词本失败：", error);
      } else {
        cards = (data ?? []) as unknown as VocabCard[];
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold text-slate-900">词汇卡片</h1>
      <p className="mt-2 text-sm text-slate-500">
        查一个词，生成释义和例句；登录后可以收藏成卡片，随时回来复习。
      </p>

      {!configured ? (
        <p className="mt-6 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          当前环境没有配置 Supabase，查词可用，但收藏功能不可用。
        </p>
      ) : null}

      {configured && !user ? (
        <p className="mt-6 text-sm text-slate-600">
          未登录也能查词，想存进生词本就{" "}
          <Link href="/login" className="text-indigo-500 transition hover:text-indigo-600">
            先登录 →
          </Link>
        </p>
      ) : null}

      <div className="mt-6">
        <VocabPanel initialCards={cards} signedIn={Boolean(user)} />
      </div>
    </div>
  );
}
