import { AppError } from "@/lib/api/errors";

/**
 * 轻量限流器——**匿名和登录用户都限**。
 *
 * 说明白这是在 trade-off：项目目的是对外展示，让访客先看到效果比防攻击更重要；
 * 同时完全不限又可能被脚本刷爆免费额度。所以两档额度都是宽松但有上限的。
 *
 * 为什么登录用户也要限：以前的实现是「登录了就不限」，但注册一个邮箱账号的成本极低
 * （邮箱确认已经关掉），脚本只要注册几个小号就能把匿名额度整个绕过去，等于没限。
 *
 * 实现是**进程内内存计数**：Serverless 环境下每个实例各自计数，
 * 所以它不是严格的全局限流，只能挡住最粗暴的循环调用。
 * 要真正严格的限流得上 Redis 之类的共享存储——对个人作品集项目不值当。
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

/** key -> 计数。匿名是 ip:xxx，登录是 user:xxx，两者互不干扰 */
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

/**
 * 校验这次请求是否还在额度内，超了就抛 429。
 *
 * @param userId 登录用户的 ID；传 null 表示匿名访客
 */
export function assertQuota(request: Request, userId: string | null): void {
  const now = Date.now();
  const limit = userId ? SIGNED_IN_MAX : ANONYMOUS_MAX;
  const key = userId ? `user:${userId}` : `ip:${getClientIp(request)}`;

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
    throw new AppError(
      userId ? "操作太频繁了，歇一会儿再试" : "试用次数到上限了，登录后可继续使用",
      "RATE_LIMITED",
      429,
    );
  }

  bucket.count += 1;
}
