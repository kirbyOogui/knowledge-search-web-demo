import type { RetrievedChunk } from "./claude";

type SupabaseInsertClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  };
};

export async function logQuery(
  supabase: SupabaseInsertClient,
  params: {
    slackUserId: string;
    department: string | null;
    question: string;
    chunks: RetrievedChunk[];
    answerFound: boolean;
    channel?: string;
  }
): Promise<void> {
  // ファイル名単位ではなくチャンクIDまで残すことで、どのセクションが
  // 実際にAIの回答根拠として使われたかを事後に正確に追跡できるようにする
  const retrievedChunkIds = params.chunks.map((c) => c.id);

  const { error } = await supabase.from("query_logs").insert({
    slack_user_id: params.slackUserId,
    department: params.department,
    question: params.question,
    retrieved_chunk_ids: retrievedChunkIds,
    channel: params.channel ?? "slack",
    answer_found: params.answerFound,
  });

  // 監査ログの書き込み失敗はユーザー応答をブロックしない（ログ用途のため）が、必ずコンソールには残す
  if (error) console.error("query_logs insert failed:", error);
}
