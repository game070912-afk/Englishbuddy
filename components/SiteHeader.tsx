import Link from "next/link";

import AuthStatus from "@/components/AuthStatus";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * 全站顶部导航。
 * 服务端读取登录态，避免客户端闪一下「未登录」再变「已登录」。
 */
export default async function SiteHeader() {
  const configured = isSupabaseConfigured();
  const supabase = await createClient();
  const { data } = await supabase?.auth.getUser() ?? { data: { user: null } };
  const email = data.user?.email ?? null;

  return (
    <header className="h-16 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-full max-w-3xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-semibold text-indigo-500">
          EnglishBuddy
        </Link>
        <nav className="flex items-center gap-4 text-sm text-slate-600">
          <Link href="/chat" className="transition hover:text-indigo-500">
            对话练习
          </Link>
          <Link href="/correct" className="transition hover:text-indigo-500">
            语法纠错
          </Link>
          <Link href="/vocab" className="transition hover:text-indigo-500">
            生词本
          </Link>
          {email ? (
            <Link href="/history" className="transition hover:text-indigo-500">
              历史
            </Link>
          ) : null}
          <AuthStatus email={email} configured={configured} />
        </nav>
      </div>
    </header>
  );
}
