import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ingestDocument } from "../lib/ingest-pipeline";
import { createAdminClient } from "../lib/supabase/admin";

const PDF_DIR = path.join(process.cwd(), "test-data", "pdfs");
const REQUEST_INTERVAL_MS = 21000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const files = (await readdir(PDF_DIR)).filter((f) => f.toLowerCase().endsWith(".pdf"));
  if (files.length === 0) {
    console.log(`PDFが見つかりません: ${PDF_DIR}`);
    return;
  }

  const supabase = createAdminClient();

  for (const [fileIndex, file] of files.entries()) {
    if (fileIndex > 0) await sleep(REQUEST_INTERVAL_MS);
    console.log(`\n[${file}] 取り込み開始`);

    const buffer = await readFile(path.join(PDF_DIR, file));
    // ローカルPDFからの取り込みのため source_url は未設定（SharePoint同期時に設定される）
    const result = await ingestDocument(supabase, { sourceFile: file, buffer, sourceUrl: null });

    console.log(`  - 部署: ${result.department} / ${result.chunkCount}チャンクをcase7.chunksへ保存`);
  }

  console.log("\n取り込み完了");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
