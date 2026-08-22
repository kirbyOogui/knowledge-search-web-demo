import { embedQuery } from "./embeddings";
import type { RetrievedChunk } from "./claude";

type SupabaseRpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function searchChunks(
  supabase: SupabaseRpcClient,
  question: string,
  allowedDepartments: string[],
  options?: { matchThreshold?: number; matchCount?: number }
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embedQuery(question);

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: queryEmbedding,
    p_departments: allowedDepartments,
    // voyage-3の実測コサイン類似度は0.7よりずっと低い水準で分布するため
    // 案件3の実測値（正解チャンクで約0.39）に合わせて閾値を下げている
    match_threshold: options?.matchThreshold ?? 0.25,
    match_count: options?.matchCount ?? 5,
  });

  if (error) throw error;
  return (data ?? []) as RetrievedChunk[];
}
