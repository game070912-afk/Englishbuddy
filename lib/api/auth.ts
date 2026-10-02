import { AppError } from "@/lib/api/errors";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export interface CurrentUser {
  id: string;
  email: string;
}

/**
 * 取出当前登录用户。
 * 未配置 Supabase 时返回 null（本地不接数据库也能跑）。
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = await createClient();
  if (!supabase) {
    return null;
  }

  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return null;
  }

  return { id: data.user.id, email: data.user.email ?? "" };
}

/**
 * 要求请求方已登录，否则抛 401。
 *
 * 这条是 AI 接口的保护闸门：仓库公开、线上可访问，若不限登录，
 * 任何人都能脚本刷接口，把免费额度烧光。
 * 未配置 Supabase 时放行，保证「不接数据库也能本地跑通」。
 */
export async function requireUser(): Promise<CurrentUser | null> {
  const user = await getCurrentUser();

  if (isSupabaseConfigured() && !user) {
    throw new AppError("请先登录再使用 AI 功能", "UNAUTHORIZED", 401);
  }

  return user;
}
