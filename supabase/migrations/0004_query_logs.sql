-- 監査ログ: 誰がいつ何を質問し、どの文書がヒットしたかを記録する
-- 実行方法: Supabase Dashboard > SQL Editor で実行

create table if not exists case7.query_logs (
  id uuid primary key default gen_random_uuid(),
  slack_user_id text,
  department text,
  question text not null,
  matched_source_files text[] not null default '{}',
  answer_found boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists query_logs_created_at_idx on case7.query_logs (created_at desc);
create index if not exists query_logs_slack_user_id_idx on case7.query_logs (slack_user_id);

alter table case7.query_logs enable row level security;

grant select, insert on case7.query_logs to service_role;
