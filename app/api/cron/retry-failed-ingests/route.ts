import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { downloadFile, reconstructFile } from "../../../../lib/sharepoint";
import { ingestDocument } from "../../../../lib/ingest-pipeline";
import { recordIngestFailure, clearIngestFailure } from "../../../../lib/ingest-failures";

export const maxDuration = 300;

type IngestFailureRow = {
  source_file: string;
  source_url: string | null;
  sharepoint_item_id: string | null;
  retry_count: number;
};

// case7.ingest_failuresに記録された取り込み失敗を毎週まとめて再試行する。
// sharepoint-syncの日次/月次カーソルとは独立しているため、
// 一度失敗したファイルが放置され続けることを防ぐ。
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: failures, error } = await supabase.from("ingest_failures").select("*");
  if (error) {
    console.error(error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }

  const results: { file: string; status: "ok" | "error"; retryCount?: number; error?: string }[] = [];

  for (const failure of (failures ?? []) as IngestFailureRow[]) {
    if (!failure.sharepoint_item_id) {
      // SharePoint以外の経路（ローカルingest等）で発生した失敗は、SharePoint API経由では再取得できない
      results.push({ file: failure.source_file, status: "error", error: "sharepoint_item_id が無いため再試行不可" });
      continue;
    }

    try {
      const file = reconstructFile({
        name: failure.source_file,
        webUrl: failure.source_url ?? "",
        itemId: failure.sharepoint_item_id,
      });
      const buffer = await downloadFile(file);
      const result = await ingestDocument(supabase, {
        sourceFile: file.name,
        buffer,
        sourceUrl: file.webUrl,
        batchDelay: false,
      });
      await clearIngestFailure(supabase, failure.source_file);
      results.push({ file: failure.source_file, status: "ok" });
      void result;
    } catch (err) {
      console.error(`リトライ失敗 (${failure.source_file}):`, err);
      await recordIngestFailure(supabase, {
        sourceFile: failure.source_file,
        sourceUrl: failure.source_url,
        sharepointItemId: failure.sharepoint_item_id,
        errorMessage: String(err),
      });
      results.push({
        file: failure.source_file,
        status: "error",
        retryCount: failure.retry_count + 1,
        error: String(err),
      });
    }
  }

  return NextResponse.json({ retried: results.length, results });
}
