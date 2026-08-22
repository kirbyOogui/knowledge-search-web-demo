import { createAdminClient } from "@/lib/supabase/admin";
import { searchChunks } from "@/lib/search";
import { generateAnswer, NOT_FOUND_MARKER } from "@/lib/claude";
import { logQuery } from "@/lib/query-log";
import { consumeRateLimit, getClientIp } from "@/lib/rate-limit";

// Slackに次ぐ、もう一つの正式な問い合わせ経路としてのWeb API。
// 認証機能がまだ無いため、部署は自己申告制のセレクトボックスから受け取る
// (将来的にログイン機能を追加する際は、Slack連携時のslack_users同様に
// ユーザー→部署の解決をサーバー側で行う設計に置き換える)。
const supabase = createAdminClient();

const ALLOWED_DEPARTMENTS = ["戦略", "人事", "IT", "営業"];

const RATE_LIMIT = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rateLimit = consumeRateLimit(`ask:${ip}`, RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "リクエストが多すぎます。しばらくしてから再度お試しください。" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) } }
    );
  }

  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const department = typeof body?.department === "string" ? body.department : "";
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "web-anonymous";

  if (!question) {
    return Response.json({ error: "質問を入力してください。" }, { status: 400 });
  }
  if (question.length > 300) {
    return Response.json({ error: "質問は300文字以内で入力してください。" }, { status: 400 });
  }
  if (!ALLOWED_DEPARTMENTS.includes(department)) {
    return Response.json({ error: "部署を選択してください。" }, { status: 400 });
  }

  try {
    const chunks = await searchChunks(supabase, question, [department]);
    const result = await generateAnswer(question, chunks);
    const answerFound = !result.answer.includes(NOT_FOUND_MARKER);

    await logQuery(supabase, {
      slackUserId: `web:${sessionId}`,
      department,
      question,
      chunks,
      answerFound,
      channel: "web",
    });

    return Response.json({ answer: result.answer, citations: result.citations });
  } catch (err) {
    console.error("ask API error:", err);
    return Response.json(
      { error: "回答の生成に失敗しました。しばらくしてから再度お試しください。" },
      { status: 500 }
    );
  }
}
