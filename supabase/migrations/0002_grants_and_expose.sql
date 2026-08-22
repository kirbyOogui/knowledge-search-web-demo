-- case7スキーマをPostgREST/APIから使えるようにするための権限付与
-- 実行方法: Supabase Dashboard > SQL Editor で実行
-- これを実行した後、Dashboard > Project Settings > Data API > Exposed schemas に
-- "case7" を追加することも必要（SQLだけでは公開されない）

grant usage on schema case7 to anon, authenticated, service_role;

grant all on all tables in schema case7 to service_role;
grant all on all sequences in schema case7 to service_role;
grant all on all functions in schema case7 to service_role;

grant select on case7.documents to authenticated;
grant select on case7.chunks to authenticated;

grant execute on function case7.match_chunks(extensions.vector, text[], float, int) to authenticated;
