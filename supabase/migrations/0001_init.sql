-- 案件7: ナレッジ検索AI（RAG + Slack連携）MVP 初期スキーマ
-- 実行方法: Supabase Dashboard > SQL Editor にこの内容を貼り付けて実行する
-- 注意: このSupabaseプロジェクトは他案件（ragmvp/cs_chat/salon等）と共有のため、
--       専用の case7 スキーマのみを使う。

create schema if not exists case7;

create extension if not exists vector with schema extensions;

-- ============================================================
-- documents: 文書単位のメタデータ（部署別アクセス制御の単位）
-- ============================================================
create table if not exists case7.documents (
  id uuid primary key default gen_random_uuid(),
  source_file text not null unique,
  title text not null,
  department text not null,
  client_name text,
  created_year int,
  confidentiality text not null default '社外秘',
  source_url text, -- SharePoint等の元文書URL（0003で追加、月次自動取り込み時に設定）
  created_at timestamptz not null default now()
);

-- ============================================================
-- chunks: セクション単位のチャンク本文 + Embedding
-- ============================================================
create table if not exists case7.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references case7.documents(id) on delete cascade,
  heading text not null,
  content text not null,
  page_start int not null,
  page_end int not null,
  embedding extensions.vector(1024) not null,
  created_at timestamptz not null default now()
);

create index if not exists chunks_embedding_idx
  on case7.chunks
  using hnsw (embedding extensions.vector_cosine_ops);

create index if not exists chunks_document_id_idx on case7.chunks (document_id);

-- ============================================================
-- slack_users: Slackユーザー ⇔ 部署のマッピング（Slack連携フェーズで使用）
-- ============================================================
create table if not exists case7.slack_users (
  slack_user_id text primary key,
  display_name text,
  department text not null,
  created_at timestamptz not null default now()
);

alter table case7.documents enable row level security;
alter table case7.chunks enable row level security;
alter table case7.slack_users enable row level security;

-- 認証済みロールでの直接アクセスは将来のSlack連携フェーズ向けの土台。
-- 実際の部署別アクセス制御は match_chunks RPC の p_departments 引数で行う
-- （Slackボットのバックエンドが slack_users から部署を解決し、ユーザー自身が
-- 任意の部署を指定できないようにする）。
create policy "authenticated can read own scope placeholder"
  on case7.documents for select
  to authenticated
  using (true);

-- ============================================================
-- match_chunks: 部署フィルタ付きコサイン類似度検索RPC
-- ============================================================
-- match_threshold: voyage-3の実測コサイン類似度は0.7よりずっと低い水準で分布するため
-- 案件3の実測値に合わせてデフォルト0.25とする（要再検証）
create or replace function case7.match_chunks(
  query_embedding extensions.vector(1024),
  p_departments text[],
  match_threshold float default 0.25,
  match_count int default 5
)
returns table (
  id uuid,
  content text,
  heading text,
  document_title text,
  source_file text,
  department text,
  page_start int,
  page_end int,
  similarity float
)
language sql
stable
security invoker
set search_path = case7, extensions
as $$
  select
    c.id,
    c.content,
    c.heading,
    d.title,
    d.source_file,
    d.department,
    c.page_start,
    c.page_end,
    1 - (c.embedding <=> query_embedding) as similarity
  from case7.chunks c
  join case7.documents d on d.id = c.document_id
  where d.department = any(p_departments)
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function case7.match_chunks(extensions.vector, text[], float, int) to authenticated, service_role;
