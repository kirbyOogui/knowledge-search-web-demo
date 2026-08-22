-- 監査ログの精度向上: ファイル名単位ではなくチャンク単位で参照先を記録する。
-- また将来Web UI等の別チャネルが増えることを見越してchannelカラムを追加する。
-- 実行方法: Supabase Dashboard > SQL Editor で実行

alter table case7.query_logs
  add column if not exists retrieved_chunk_ids uuid[] not null default '{}',
  add column if not exists channel text not null default 'slack';

alter table case7.query_logs drop column if exists matched_source_files;

drop index if exists case7.query_logs_slack_user_id_idx;
create index if not exists query_logs_user_created_idx on case7.query_logs (slack_user_id, created_at desc);
