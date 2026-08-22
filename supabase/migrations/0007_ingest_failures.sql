-- SharePoint取り込みの失敗を永続的に記録し、週次リトライジョブが再試行できるようにする。
-- 実行方法: Supabase Dashboard > SQL Editor で実行

create table if not exists case7.ingest_failures (
  id uuid primary key default gen_random_uuid(),
  source_file text not null,
  source_url text,
  sharepoint_item_id text,
  error_message text not null,
  retry_count int not null default 0,
  first_failed_at timestamptz not null default now(),
  last_attempted_at timestamptz not null default now()
);

create unique index if not exists ingest_failures_source_file_idx on case7.ingest_failures (source_file);

alter table case7.ingest_failures enable row level security;

grant select, insert, update, delete on case7.ingest_failures to service_role;
