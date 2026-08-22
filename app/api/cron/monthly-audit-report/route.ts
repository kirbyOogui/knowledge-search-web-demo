import { NextResponse } from "next/server";
import { WebClient } from "@slack/web-api";
import { createAdminClient } from "../../../../lib/supabase/admin";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

type QueryLogRow = {
  department: string | null;
  answer_found: boolean;
  slack_user_id: string;
};

// 前月分の検索ログを部署別に集計し、統括チャンネルへ月次サマリーを投稿する。
// 現状case7.slack_usersに「誰が部署管理者か」という情報を持っていないため、
// 部署管理者ごとの個別配信ではなく統括チャンネルへの一括投稿としている
// （個別配信が必要になった場合はslack_usersにmanagerフラグ等の追加が必要）。
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const channel = process.env.AUDIT_REPORT_CHANNEL_ID;
  if (!channel) {
    return NextResponse.json({ error: "AUDIT_REPORT_CHANNEL_ID が未設定です" }, { status: 500 });
  }

  const supabase = createAdminClient();

  const now = new Date();
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const firstOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const { data: logs, error } = await supabase
    .from("query_logs")
    .select("department, answer_found, slack_user_id")
    .gte("created_at", firstOfLastMonth.toISOString())
    .lt("created_at", firstOfThisMonth.toISOString());

  if (error) {
    console.error(error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }

  const byDept = new Map<string, { total: number; notFound: number; users: Set<string> }>();
  for (const log of (logs ?? []) as QueryLogRow[]) {
    const key = log.department ?? "(アクセス権限未登録ユーザー)";
    const entry = byDept.get(key) ?? { total: 0, notFound: 0, users: new Set<string>() };
    entry.total++;
    if (!log.answer_found) entry.notFound++;
    entry.users.add(log.slack_user_id);
    byDept.set(key, entry);
  }

  const monthLabel = `${firstOfLastMonth.getUTCFullYear()}年${firstOfLastMonth.getUTCMonth() + 1}月`;
  const lines = [`📊 *ナレッジ検索AI 月次利用レポート（${monthLabel}）*`, ""];

  if (byDept.size === 0) {
    lines.push("この期間の検索ログはありませんでした。");
  } else {
    for (const [dept, stats] of byDept) {
      lines.push(
        `• ${dept}: ${stats.total}件の質問（利用者${stats.users.size}名、該当なし回答${stats.notFound}件）`
      );
    }
  }

  await slack.chat.postMessage({ channel, text: lines.join("\n") });

  return NextResponse.json({ status: "ok", departments: byDept.size });
}
