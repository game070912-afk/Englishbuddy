import { AppError } from "@/lib/api/errors";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

/**
 * 接口额度限流——**匿名和登录用户都限**，计数落在数据库里。
 *
 * 为什么要落数据库：限流最早是进程内内存计数，但部署平台（实测 EdgeOne Makers）
 * 每次请求都跑在独立实例上，内存里的计数根本累积不起来——线上连发 25 次一次都没拦住。
 * 只有把计数放到所有实例共享的地方（这里用 Supabase）才真的生效。
 *
 * 为什么登录用户也要限：以前的实现是「登录了就不限」，但注册一个邮箱账号成本极低
 * （邮箱确认已经关掉），脚本只要注册几个小号就能把匿名额度整个绕过去，等于没限。
 *
 * 降级策略：数据库连不上、表还没建、Supabase 根本没配——任何一种情况都**退回内存计数**
 * 并放行本次请求。限流出问题绝不能让整站用不了，宁可放宽。
 */

/** 计数窗口长度 */
const WINDOW_MS = 10 * 60 * 1000;
/** 匿名访客：一个窗口内最多请求多少次（按 IP 计） */
const ANONYMOUS_MAX = 20;
/** 登录用户：一个窗口内最多请求多少次（按用户 ID 计） */
const SIGNED_IN_MAX = 60;
/** 超过这个条目数就清理一遍，避免内存无限增长 */
const MAX_BUCKET_SIZE = 2000;

interface Bucket {
  count: number;
  resetAt: number;
}

/** 内存兜底用的计数表。key 形如 ip:1.2.3.4 或 user:uuid */
const buckets = new Map<string, Bucket>();

/** 尽力获取客户端 IP，取不到就归到一个桶里 */
function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0];
    if (first) {
      return first.trim();
    }
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function exceededMessage(userId: string | null): string {
  return userId ? "操作太频繁了，歇一会儿再试" : "试用次数到上限了，登录后可继续使用";
}

/** 进程内计数：只在数据库用不了时兜底，多实例下并不严格 */
function assertInMemory(key: string, limit: number, userId: string | null): void {
  const now = Date.now();

  if (buckets.size > MAX_BUCKET_SIZE) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(bucketKey);
      }
    }
  }

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }

  if (bucket.count >= limit) {
    throw new AppError(exceededMessage(userId), "RATE_LIMITED", 429);
  }

  bucket.count += 1;
}

/**
 * 走数据库计数。
 *
 * @returns true=放行 / false=已超限 / null=用不了（没配 Supabase 或调用失败）
 */
async function consumeRemoteQuota(key: string, limit: number): Promise<boolean | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const supabase = await createClient();
    if (!supabase) {
      return null;
    }

    const { data, error } = await supabase.rpc("consume_api_quota", {
      p_key: key,
      p_window_ms: WINDOW_MS,
      p_max: limit,
    });

    if (error || typeof data !== "boolean") {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * 校验这次请求是否还在额度内，超了就抛 429。
 *
 * @param userId 登录用户的 ID；传 null 表示匿名访客
 */
export async function assertQuota(request: Request, userId: string | null): Promise<void> {
  const limit = userId ? SIGNED_IN_MAX : ANONYMOUS_MAX;
  const key = userId ? `user:${userId}` : `ip:${getClientIp(request)}`;

  const allowed = await consumeRemoteQuota(key, limit);

  if (allowed === null) {
    assertInMemory(key, limit, userId);
    return;
  }

  if (!allowed) {
    throw new AppError(exceededMessage(userId), "RATE_LIMITED", 429);
  }
}
