import { extractPdfPages } from "./pdf";
import { parseDocMeta, extractSections } from "./sections";
import { toChunks } from "./chunking";
import { embedDocuments } from "./embeddings";

const EMBED_BATCH_SIZE = 16;
// Voyage AIは支払い方法未設定だと3 RPMに制限されるため、バッチ間隔を空ける
const REQUEST_INTERVAL_MS = 21000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SupabaseIngestClient = {
  from: (table: string) => {
    delete: () => { eq: (col: string, val: string) => PromiseLike<{ error: unknown }> };
    insert: (row: Record<string, unknown> | Record<string, unknown>[]) => {
      select: (cols: string) => {
        single: () => PromiseLike<{ data: { id: string } | null; error: unknown }>;
      };
    } & PromiseLike<{ error: unknown }>;
  };
};

export type IngestResult = {
  sourceFile: string;
  department: string;
  chunkCount: number;
};

// 1つのPDFをセクション単位でチャンキング・Embedding生成し、Supabaseへ保存する。
// CLIの一括取り込み（scripts/ingest.ts）とSharePoint月次同期（cronジョブ）の両方から使う共通処理。
export async function ingestDocument(
  supabase: SupabaseIngestClient,
  params: { sourceFile: string; buffer: Buffer; sourceUrl: string | null; batchDelay?: boolean }
): Promise<IngestResult> {
  const { sourceFile, buffer, sourceUrl } = params;

  const pages = await extractPdfPages(buffer);
  const meta = parseDocMeta(pages);
  const sections = extractSections(pages);
  const chunks = toChunks(sections);

  const { error: deleteError } = await supabase.from("documents").delete().eq("source_file", sourceFile);
  if (deleteError) throw deleteError;

  const { data: doc, error: insertDocError } = await supabase
    .from("documents")
    .insert({
      source_file: sourceFile,
      title: meta.title,
      department: meta.department,
      client_name: meta.clientName,
      created_year: meta.createdYear,
      confidentiality: meta.confidentiality,
      source_url: sourceUrl,
    })
    .select("id")
    .single();
  if (insertDocError) throw insertDocError;
  if (!doc) throw new Error(`documentの登録に失敗しました: ${sourceFile}`);

  const rows: {
    document_id: string;
    heading: string;
    content: string;
    page_start: number;
    page_end: number;
    embedding: number[];
  }[] = [];

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    if (i > 0 && params.batchDelay !== false) await sleep(REQUEST_INTERVAL_MS);
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedDocuments(batch.map((c) => c.content));
    batch.forEach((chunk, j) => {
      rows.push({
        document_id: doc.id,
        heading: chunk.heading,
        content: chunk.content,
        page_start: chunk.pageStart,
        page_end: chunk.pageEnd,
        embedding: embeddings[j],
      });
    });
  }

  const { error: insertChunksError } = await supabase.from("chunks").insert(rows);
  if (insertChunksError) throw insertChunksError;

  return { sourceFile, department: meta.department, chunkCount: rows.length };
}
