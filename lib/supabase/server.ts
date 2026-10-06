import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/config";
import { realtimeOptions } from "@/lib/supabase/realtime";

/**
 * 服务端 Supabase 客户端，用于 Server Component、Server Action 与 Route Handler。
 *
 * Server Component 里无法写 cookie，所以 setAll 的写入失败要吞掉——
 * 刷新 token 的职责由根目录的 proxy.ts 承担（Next.js 16 起中间件改名为 proxy）。
 *
 * @returns 客户端实例；未配置 Supabase 时返回 null，调用方需自行降级
 */
export async function createClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    ...realtimeOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // 在 Server Component 中调用时写 cookie 会抛错，交给 proxy.ts 处理
        }
      },
    },
  });
}
