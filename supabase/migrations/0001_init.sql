-- EnglishBuddy 初始化表结构与行级安全策略
-- 在 Supabase 控制台的 SQL Editor 里整段执行即可

-- 用户扩展信息
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  english_level text not null default 'intermediate'
    check (english_level in ('beginner', 'intermediate', 'advanced')),
  created_at timestamptz not null default now()
);

-- 会话
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  topic text not null default '日常交流',
  level text not null default 'intermediate'
    check (level in ('beginner', 'intermediate', 'advanced')),
  created_at timestamptz not null default now()
);

-- 消息
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 4000),
  corrections jsonb,
  created_at timestamptz not null default now()
);

-- 词汇卡片
create table if not exists public.vocab_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  word text not null,
  phonetic text,
  definition text,
  example_sentence text,
  context text,
  created_at timestamptz not null default now()
);

-- 索引
create index if not exists conversations_user_id_idx on public.conversations (user_id);
create index if not exists messages_conversation_id_idx on public.messages (conversation_id);
create index if not exists vocab_cards_user_id_idx on public.vocab_cards (user_id);

-- 行级安全：用户只能读写自己的数据
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.vocab_cards enable row level security;

drop policy if exists "profiles 自助读写" on public.profiles;
create policy "profiles 自助读写" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "conversations 自助读写" on public.conversations;
create policy "conversations 自助读写" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "messages 按会话归属读写" on public.messages;
create policy "messages 按会话归属读写" on public.messages
  for all using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "vocab_cards 自助读写" on public.vocab_cards;
create policy "vocab_cards 自助读写" on public.vocab_cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 注册时自动创建 profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
