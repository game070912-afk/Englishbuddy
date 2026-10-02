"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "register";

/** 把 Supabase 的英文报错翻译成人话 */
function translateError(message: string): string {
  if (message.includes("Invalid login credentials")) {
    return "邮箱或密码不对，再试一次";
  }
  if (message.includes("Email not confirmed")) {
    return "邮箱还没验证，去收件箱点一下确认链接";
  }
  if (message.includes("User already registered")) {
    return "这个邮箱已经注册过了，直接登录吧";
  }
  if (message.includes("Password should be at least")) {
    return "密码太短了，至少 6 位";
  }
  if (message.includes("unable to validate email") || message.includes("invalid format")) {
    return "邮箱格式看着不对，检查一下";
  }
  if (message.includes("Signups not allowed") || message.includes("signups not allowed")) {
    return "这个项目暂时关闭了新用户注册，需要去 Supabase 控制台打开";
  }
  if (message.includes("already been registered") || message.includes("already registered")) {
    return "这个邮箱已经注册过了，直接登录吧";
  }
  if (message.includes("only request this once every")) {
    return "操作太频繁了，等一分钟再试";
  }
  // 兜底：把 Supabase 的原文一起亮出来，方便定位问题
  return `操作没成功（原因：${message}）`;
}

/**
 * 邮箱 + 密码的登录 / 注册表单。
 * 未配置 Supabase 时给出明确提示，而不是静默失败。
 */
export default function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSubmitting(true);

    const supabase = createClient();
    if (!supabase) {
      setError("还没配置 Supabase，登录功能暂不可用（聊天和纠错不受影响）");
      setSubmitting(false);
      return;
    }

    try {
      if (mode === "register") {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password });

        if (signUpError) {
          setError(translateError(signUpError.message));
          return;
        }

        // 开了邮箱验证时，注册成功但还没登录态，需要去邮箱确认
        if (data.session === null) {
          setNotice("注册成功！请先去邮箱点确认链接，然后回来登录");
          setMode("login");
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

        if (signInError) {
          setError(translateError(signInError.message));
          return;
        }
      }

      router.push("/chat");
      router.refresh();
    } catch {
      setError("网络不太顺，稍后再试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          邮箱
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm font-medium text-slate-700">
          密码
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={6}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="至少 6 位"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "处理中…" : mode === "register" ? "注册并登录" : "登录"}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setError("");
          setNotice("");
        }}
        className="w-full text-sm text-slate-500 transition hover:text-indigo-500"
      >
        {mode === "login" ? "还没有账号？点这里注册" : "已经有账号了？点这里登录"}
      </button>
    </form>
  );
}
