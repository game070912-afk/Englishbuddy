import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * 刷新 Supabase 登录态。
 *
 * 文件名必须是 proxy.ts —— Next.js 16 起中间件从 middleware.ts 改名而来，
 * 写成 middleware.ts 会**静默失效**（不报错，但函数根本不执行）。
 * 导出函数名对应为 proxy（也可以 default 导出）。
 *
 * 这里只做「刷新过期 token」这一件事，不做权限判断。
 * 原因：Proxy 只适合乐观检查，真正的授权要在服务端数据访问处做（RLS + 接口内校验）。
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  // 没配 Supabase 时直接放行，保证不登录也能正常聊天
  if (!isSupabaseConfigured()) {
    return response;
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // 先把新 cookie 写回请求，让本次请求后续的处理能读到最新登录态
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        // 再写回响应，让浏览器更新自己的 cookie
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // 调用 getUser() 会触发 token 刷新；不要用 getSession()，那个不校验签名
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // 跳过静态资源与图片优化请求，避免无谓的函数调用
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
