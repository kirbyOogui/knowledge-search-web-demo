-- SharePoint連携（月次自動取り込み）で元文書へのリンクを保持するためのカラムを追加
-- 実行方法: Supabase Dashboard > SQL Editor で実行

alter table case7.documents add column if not exists source_url text;

-- match_chunksの戻り値にsource_urlを追加するため、シグネチャを変更して再作成する
drop function if exists case7.match_chunks(extensions.vector, text[], float, int);

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
  source_url text,
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
    d.source_url,
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
