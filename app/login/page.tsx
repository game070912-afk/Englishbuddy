import Link from "next/link";

import AuthForm from "@/components/AuthForm";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata = { title: "登录 · EnglishBuddy" };

/**
 * 登录 / 注册页。
 * 未配置 Supabase 时页面照常展示，只是提示登录暂不可用——
 * 保证「没配数据库也能把项目跑起来」。
 */
export default function LoginPage() {
  const configured = isSupabaseConfigured();

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold text-slate-900">登录 EnglishBuddy</h1>
      <p className="mt-2 text-sm text-slate-500">
        登录后可以保存每次对话记录，换设备也能接着看。
        <br />
        不登录也能正常聊天和批改，只是不留历史。
      </p>

      {configured ? null : (
        <p className="mt-6 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          当前环境没有配置 Supabase，登录暂不可用。填好
          <code className="mx-1 rounded bg-amber-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code>
          和
          <code className="mx-1 rounded bg-amber-100 px-1">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>
          后重启即可。
        </p>
      )}

      <div className="mt-6">
        <AuthForm />
      </div>

      <p className="mt-8 text-center text-sm text-slate-400">
        <Link href="/" className="transition hover:text-indigo-500">
          ← 回首页
        </Link>
      </p>
    </div>
  );
}
