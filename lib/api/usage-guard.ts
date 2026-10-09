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
/**
 * 全站总闸：一个窗口内所有 AI 调用加起来的上限。
 *
 * 为什么还要这一层：上面那两层都靠「这次请求是谁」来计数，但实测在 EdgeOne 上
 * `X-Forwarded-For` 拿到的是**边缘节点自己的 IP**（表里全是 43.168.x.x 这类腾讯云段，
 * 每个桶只有两三次），45 次请求被摊到十几个桶里，永远凑不满 20。
 * 而 `EO-Client-IP` 需要在控制台开启「Client IP Header」才一定有，不是白送的。
 * 也就是说「按身份限流」在这个平台上是**尽力而为**，不能当唯一防线。
 *
 * 总闸不认身份、只认总数，所以它是唯一能确定生效的一层——
 * 真有人拿脚本刷，刷到上限全站一起停，免费额度不会被刷爆。
 * 代价是：一个坏人能让其他访客暂时用不了。对作品集站点来说，这个取舍划算。
 */
const GLOBAL_MAX = 200;
/** 全站计数用的固定 key */
const GLOBAL_KEY = "global";
/** 超过这个条目数就清理一遍，避免内存无限增长 */
const MAX_BUCKET_SIZE = 2000;

/**
 * 真实客户端 IP 的候选请求头，按可信度从高到低。
 *
 * `eo-client-ip` 是 EdgeOne 官方文档里给真实 IP 用的头（控制台可改名）。
 * 其余几个是常见 CDN / 反代的惯例，换平台部署时不用改代码。
 */
const CLIENT_IP_HEADERS = ["eo-client-ip", "true-client-ip", "x-real-ip", "eo-connecting-ip"];

interface Bucket {
  count: number;
  resetAt: number;
}

/** 内存兜底用的计数表。key 形如 ip:1.2.3.4 或 user:uuid */
const buckets = new Map<string, Bucket>();

/**
 * 尽力获取客户端真实 IP，取不到就归到一个桶里。
 *
 * 先看 CDN 厂商专门的头，最后才看 `X-Forwarded-For`——
 * 后者最左侧理论上才是真实客户端，但 EdgeOne 实测给的是边缘节点 IP，可信度最低。
 */
function getClientIp(request: Request): string {
  for (const header of CLIENT_IP_HEADERS) {
    const value = request.headers.get(header)?.trim();
    if (value) {
      return value;
    }
  }

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0];
    if (first) {
      return first.trim();
    }
  }

  return "unknown";
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

/**
 * 全站总闸：一个窗口内所有 AI 调用加起来超过上限就抛 429。
 *
 * 只在会调 AI 的接口上用（chat / correct / transcribe / vocab）。
 * `/api/conversations` 只是读写自己的数据库，不该占 AI 的额度。
 *
 * 数据库用不了时**直接放行**：全站计数本来就是跨实例才有意义，
 * 退回进程内计数等于没数，不如别挡路。
 */
export async function assertGlobalQuota(): Promise<void> {
  const allowed = await consumeRemoteQuota(GLOBAL_KEY, GLOBAL_MAX);

  if (allowed === false) {
    throw new AppError("AI 额度暂时用完了，过几分钟再试试", "RATE_LIMITED", 429);
  }
}
