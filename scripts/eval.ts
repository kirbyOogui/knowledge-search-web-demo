import { readFile } from "node:fs/promises";
import path from "node:path";
import { createAdminClient } from "../lib/supabase/admin";
import { searchChunks } from "../lib/search";
import { generateAnswer, NOT_FOUND_MARKER } from "../lib/claude";

const CSV_PATH = path.join(process.cwd(), "test-data", "case7-test-questions.csv");
const ALL_DEPARTMENTS = ["戦略", "人事", "IT", "営業", "業務", "管理"];
// ヒアリングで合意した受け入れ基準（関連文書がTop5に含まれていればOKなクエリのうち80%以上）
const RECALL_TARGET_PERCENT = 80;

type TestRow = {
  no: string;
  question: string;
  expectedDocs: string; // "（記載なし）" or "case7-docN[ / case7-docM ...]"
  expectedEvidence: string;
  kind: string; // 種別
};

function parseCsv(raw: string): TestRow[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const [, ...dataLines] = lines;
  return dataLines.map((line) => {
    const [no, question, expectedDocs, expectedEvidence, kind] = line.split(",");
    return { no, question, expectedDocs, expectedEvidence, kind };
  });
}

// 日本語は言い回し違いで単純な部分文字列一致が崩れやすいため、
// 期待回答に含まれる数値（最も言い換えられにくい事実）を基準に判定する（案件3の手法を踏襲）
function extractNumbers(text: string): string[] {
  return text.replace(/[,，]/g, "").match(/[0-9]+/g) ?? [];
}

function isAnswerMatch(expected: string, actual: string): boolean {
  const normalizedActual = actual.replace(/[,，]/g, "");
  const numbers = extractNumbers(expected);

  if (numbers.length > 0) {
    const hits = numbers.filter((n) => normalizedActual.includes(n));
    return hits.length / numbers.length >= 0.6;
  }

  const parts = expected
    .split(/[・/、,\s]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  if (parts.length === 0) return actual.includes(expected);
  const hits = parts.filter((p) => actual.includes(p));
  return hits.length / parts.length >= 0.5;
}

function expectedDocKeys(expectedDocs: string): string[] {
  return expectedDocs
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "（記載なし）");
}

function recallAt5(expectedDocs: string, retrievedSourceFiles: string[]): boolean {
  const keys = expectedDocKeys(expectedDocs);
  if (keys.length === 0) return true; // 該当なし想定の質問は対象外
  return keys.every((key) => retrievedSourceFiles.some((f) => f.startsWith(key)));
}

async function main() {
  const raw = await readFile(CSV_PATH, "utf-8");
  const rows = parseCsv(raw);
  const supabase = createAdminClient();

  let recallHits = 0;
  let recallTotal = 0;
  let answerCorrect = 0;
  let answerTotal = 0;
  let hallucinationChecks = 0;
  let hallucinationPasses = 0;

  console.log(`テスト件数: ${rows.length}\n`);

  for (const row of rows) {
    const isHallucinationCheck = row.kind.includes("該当なし");
    const isRlsCheck = row.kind.includes("RLS");

    if (isRlsCheck) {
      // 人事部ユーザーとして検索 → IT部の文書(doc3)が見えないことを確認
      const restrictedChunks = await searchChunks(supabase, row.question, ["人事"]);
      const restrictedAnswer = await generateAnswer(row.question, restrictedChunks);
      const leaked = restrictedChunks.some((c) => c.source_file.startsWith("case7-doc3"));

      // 対照実験: 全部署アクセスなら本来doc3がヒットすることを確認（埋め込み不良ではなくACLで弾かれたことの検証）
      const fullAccessChunks = await searchChunks(supabase, row.question, ALL_DEPARTMENTS);
      const wouldNormallyHit = fullAccessChunks.some((c) => c.source_file.startsWith("case7-doc3"));

      const pass = !leaked && wouldNormallyHit;
      console.log(
        `[${row.no}] ${pass ? "OK" : "NG"} (RLS検証) ${row.question}\n` +
          `  人事部スコープでdoc3流出: ${leaked ? "あり(NG)" : "なし(OK)"} / 全社スコープでdoc3ヒット: ${wouldNormallyHit ? "あり(OK)" : "なし(要確認)"}\n` +
          `  人事部スコープでの回答: ${restrictedAnswer.answer.replace(/\n/g, " ").slice(0, 100)}\n`
      );
      continue;
    }

    const chunks = await searchChunks(supabase, row.question, ALL_DEPARTMENTS);
    const { answer } = await generateAnswer(row.question, chunks);

    if (isHallucinationCheck) {
      hallucinationChecks++;
      const pass = answer.includes(NOT_FOUND_MARKER);
      if (pass) hallucinationPasses++;
      console.log(
        `[${row.no}] ${pass ? "OK" : "NG"} (ハルシネーション検証) ${row.question}\n` +
          `  実際: ${answer.replace(/\n/g, " ").slice(0, 120)}\n`
      );
      continue;
    }

    recallTotal++;
    const recallPass = recallAt5(row.expectedDocs, chunks.map((c) => c.source_file));
    if (recallPass) recallHits++;

    answerTotal++;
    const answerPass = isAnswerMatch(row.expectedEvidence, answer);
    if (answerPass) answerCorrect++;

    console.log(
      `[${row.no}] Recall@5:${recallPass ? "OK" : "NG"} 回答:${answerPass ? "OK" : "NG"} ${row.question}\n` +
        `  期待文書: ${row.expectedDocs} / 期待根拠: ${row.expectedEvidence}\n` +
        `  実際: ${answer.replace(/\n/g, " ").slice(0, 150)}\n`
    );
  }

  const recallPercent = (recallHits / recallTotal) * 100;

  console.log("========== 集計結果 ==========");
  console.log(
    `Recall@5: ${recallHits}/${recallTotal} (${recallPercent.toFixed(1)}%) ` +
      `${recallPercent >= RECALL_TARGET_PERCENT ? `[目標${RECALL_TARGET_PERCENT}%達成]` : `[目標${RECALL_TARGET_PERCENT}%未達]`}`
  );
  console.log(
    `回答正答率: ${answerCorrect}/${answerTotal} (${((answerCorrect / answerTotal) * 100).toFixed(1)}%)`
  );
  console.log(
    `ハルシネーション検証: ${hallucinationPasses}/${hallucinationChecks} ` +
      `${hallucinationPasses === hallucinationChecks ? "[全問パス]" : "[要確認]"}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
