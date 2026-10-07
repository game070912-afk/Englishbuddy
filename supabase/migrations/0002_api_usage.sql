-- 接口额度计数：让限流跨实例生效
-- 在 Supabase 控制台的 SQL Editor 里整段执行即可

-- 为什么需要它：限流原本是进程内内存计数，
-- 但部署平台（实测 EdgeOne Makers）每次请求都跑在独立实例上，
-- 内存里的计数根本累积不起来——连发 25 次一次都没拦住。
-- 计数必须落到数据库里，才能在所有实例之间共享。

create table if not exists public.api_usage (
  bucket_key text primary key,
  count integer not null default 0,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists api_usage_reset_at_idx on public.api_usage (reset_at);

-- 这张表对客户端完全封闭：开了 RLS 但**不建任何策略**，等于读写全拒。
-- 客户端只能通过下面的函数计数，没法直接改数字。
alter table public.api_usage enable row level security;

-- 原子地「计数 + 判定是否超限」：返回 true 表示这次放行
create or replace function public.consume_api_quota(
  p_key text,
  p_window_ms bigint,
  p_max integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_count integer;
begin
  insert into public.api_usage (bucket_key, count, reset_at, updated_at)
  values (p_key, 1, v_now + (p_window_ms || ' milliseconds')::interval, v_now)
  on conflict (bucket_key) do update
    set count = case
          when api_usage.reset_at <= v_now then 1
          else api_usage.count + 1
        end,
        reset_at = case
          when api_usage.reset_at <= v_now then v_now + (p_window_ms || ' milliseconds')::interval
          else api_usage.reset_at
        end,
        updated_at = v_now
  returning api_usage.count into v_count;

  -- 顺手清理过期行；概率触发，免得每次调用都多一次扫描
  if random() < 0.01 then
    delete from public.api_usage where reset_at < v_now;
  end if;

  return v_count <= p_max;
end;
$$;

revoke all on function public.consume_api_quota(text, bigint, integer) from public;
grant execute on function public.consume_api_quota(text, bigint, integer) to anon, authenticated;
