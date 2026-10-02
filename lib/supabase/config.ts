/**
 * Supabase 配置读取。
 *
 * 关键点：这两个变量带 NEXT_PUBLIC_ 前缀是**故意的**。
 * Supabase 的 publishable key 设计上就是要发到浏览器的，数据安全由数据库的
 * 行级安全策略（RLS）保证，而不是靠把密钥藏起来。
 * 绝对不能换成 service_role / secret key——那个会绕过 RLS，等于数据库裸奔。
 */

/** 项目地址，形如 https://xxxx.supabase.co */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";

/** 可公开的前端密钥，形如 sb_publishable_xxx 或旧的 JWT anon key */
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

/**
 * Supabase 是否已配置。
 * 没配置时应用降级为「不登录也能用」，只是不保存历史记录。
 */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL !== "" && SUPABASE_PUBLISHABLE_KEY !== "";
}
