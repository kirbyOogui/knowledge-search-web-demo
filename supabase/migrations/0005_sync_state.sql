-- SharePoint月次同期の進捗（最終同期日時）を記録する
-- 実行方法: Supabase Dashboard > SQL Editor で実行

create table if not exists case7.sync_state (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

grant select, insert, update on case7.sync_state to service_role;
