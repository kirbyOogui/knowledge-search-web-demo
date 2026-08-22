import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { listNewOrUpdatedPdfFiles, downloadFile } from "../../../../lib/sharepoint";
import { ingestDocument } from "../../../../lib/ingest-pipeline";
import { recordIngestFailure, clearIngestFailure } from "../../../../lib/ingest-failures";

// Vercel Cronからの呼び出しはデフォルトのタイムアウトを超える可能性があるため延長
export const maxDuration = 300;

const SYNC_STATE_KEY = "sharepoint_last_synced_at";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: state } = await supabase
    .from("sync_state")
    .select("value")
    .eq("key", SYNC_STATE_KEY)
    .maybeSingle();
  const since = state?.value ?? "1970-01-01T00:00:00Z";
  const syncStartedAt = new Date().toISOString();

  const files = await listNewOrUpdatedPdfFiles(since);

  const results: { file: string; status: "ok" | "error"; chunkCount?: number; error?: string }[] = [];

  for (const file of files) {
    try {
      const buffer = await downloadFile(file);
      // cronは低頻度実行のため、Voyage AIのレート制限はembeddings.ts側のリトライで吸収する想定
      const result = await ingestDocument(supabase, {
        sourceFile: file.name,
        buffer,
        sourceUrl: file.webUrl,
        batchDelay: false,
      });
      results.push({ file: file.name, status: "ok", chunkCount: result.chunkCount });
      // 過去に失敗記録が残っていれば、成功したので消しておく
      await clearIngestFailure(supabase, file.name);
    } catch (err) {
      console.error(`SharePoint同期エラー (${file.name}):`, err);
      results.push({ file: file.name, status: "error", error: String(err) });
      // 失敗は永続化する。sync_stateのカーソルは通常通り進めるため、
      // このファイルを毎日の差分同期だけに任せると二度と拾われなくなる。
      // 週次のリトライジョブ（scripts/またはapp/api/cron/retry-failed-ingests）が
      // ここに記録された失敗を個別に再試行する。
      await recordIngestFailure(supabase, {
        sourceFile: file.name,
        sourceUrl: file.webUrl,
        sharepointItemId: file.id,
        errorMessage: String(err),
      });
    }
  }

  await supabase.from("sync_state").upsert({ key: SYNC_STATE_KEY, value: syncStartedAt });

  return NextResponse.json({ synced: results.length, results });
}
