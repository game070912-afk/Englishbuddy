import { AppError } from "@/lib/api/errors";

/**
 * 匿名试用的轻量限流器。
 *
 * 说明白这是在 trade-off：项目目的是对外展示，让访客先看到效果比防攻击更重要；
 * 同时完全不限又可能被脚本刷爆免费额度。于是给匿名访客一个宽松但有上限的额度。
 *
 * 实现是**进程内内存计数**：Serverless 环境下每个实例各自计数，
 * 所以它不是严格的全局限流，只能挡住最粗暴的单实例循环调用。
 * 要真正严格的限流得上 Redis 或 Vercel 的付费方案——对个人作品集项目不值当。
 */

/** 计数窗口长度 */
const WINDOW_MS = 10 * 60 * 1000;
/** 单个 IP 在一个窗口内的最大请求数 */
const MAX_REQUESTS = 20;
/** 超过这个条目数就清理一遍，避免内存无限增长 */
const MAX_BUCKET_SIZE = 2000;

interface Bucket {
  count: number;
  resetAt: number;
}

/** IP -> 计数 */
const buckets = new Map<string, Bucket>();

/** 尽力获取客户端 IP，取不到就归到一个桶里 */
function getClientKey(request: Request): string {
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
 * 校验匿名请求是否还在额度内，超了就抛 429。
 * 已登录用户不走这条路。
 */
export function assertAnonymousQuota(request: Request): void {
  const now = Date.now();
  const key = getClientKey(request);

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

  if (bucket.count >= MAX_REQUESTS) {
    throw new AppError("试用次数到上限了，登录后可继续使用", "RATE_LIMITED", 429);
  }

  bucket.count += 1;
}
