// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseFailuresClient = any;

// 取り込み失敗をcase7.ingest_failuresに記録する（同じsource_fileなら retry_count を+1して更新）
export async function recordIngestFailure(
  supabase: SupabaseFailuresClient,
  params: { sourceFile: string; sourceUrl: string | null; sharepointItemId: string | null; errorMessage: string }
): Promise<void> {
  const { data: existing } = await supabase
    .from("ingest_failures")
    .select("retry_count")
    .eq("source_file", params.sourceFile)
    .maybeSingle();

  const { error } = await supabase.from("ingest_failures").upsert(
    {
      source_file: params.sourceFile,
      source_url: params.sourceUrl,
      sharepoint_item_id: params.sharepointItemId,
      error_message: params.errorMessage,
      retry_count: (existing?.retry_count ?? -1) + 1,
      last_attempted_at: new Date().toISOString(),
    },
    { onConflict: "source_file" }
  );

  if (error) console.error("ingest_failures upsert failed:", error);
}

export async function clearIngestFailure(supabase: SupabaseFailuresClient, sourceFile: string): Promise<void> {
  const { error } = await supabase.from("ingest_failures").delete().eq("source_file", sourceFile);
  if (error) console.error("ingest_failures delete failed:", error);
}
