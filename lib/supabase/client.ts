import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * 浏览器端 Supabase 客户端。
 * 用于客户端组件里的登录、注册、读取自己的数据。
 *
 * @returns 客户端实例；未配置 Supabase 时返回 null，调用方需自行降级
 */
export function createClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
