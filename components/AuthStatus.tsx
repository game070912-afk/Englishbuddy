"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

interface AuthStatusProps {
  /** 当前登录用户的邮箱；未登录或未配置 Supabase 时为 null */
  email: string | null;
  /** Supabase 是否已配置 */
  configured: boolean;
}

/** 顶栏右侧的登录状态展示与退出操作 */
export default function AuthStatus({ email, configured }: AuthStatusProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (!configured) {
    return null;
  }

  if (!email) {
    return (
      <Link href="/login" className="transition hover:text-indigo-500">
        登录
      </Link>
    );
  }

  async function handleSignOut() {
    setPending(true);
    const supabase = createClient();
    await supabase?.auth.signOut();
    router.push("/");
    router.refresh();
    setPending(false);
  }

  return (
    <span className="flex items-center gap-2">
      <span className="max-w-32 truncate text-slate-500" title={email}>
        {email}
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={pending}
        className="text-slate-400 transition hover:text-rose-500 disabled:opacity-50"
      >
        退出
      </button>
    </span>
  );
}
