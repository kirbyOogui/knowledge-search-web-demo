import { App } from "@slack/bolt";
import { createAdminClient } from "../lib/supabase/admin";
import { searchChunks } from "../lib/search";
import { generateAnswer, NOT_FOUND_MARKER } from "../lib/claude";
import { logQuery } from "../lib/query-log";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const supabase = createAdminClient();

function stripMention(text: string): string {
  return text.replace(/<@[^>]+>/g, "").trim();
}

app.event("app_mention", async ({ event, client, say }) => {
  const question = stripMention(event.text);
  const threadTs = event.thread_ts ?? event.ts;

  if (!question) {
    await say({
      text: "質問内容を書いてください。例: `@knowledge ROI試算のある提案書はどれ？`",
      thread_ts: threadTs,
    });
    return;
  }

  const { data: userRow, error: userError } = await supabase
    .from("slack_users")
    .select("department")
    .eq("slack_user_id", event.user)
    .maybeSingle();

  if (userError) {
    console.error(userError);
    await say({ text: "内部エラーが発生しました。しばらくしてから再度お試しください。", thread_ts: threadTs });
    return;
  }

  if (!userRow) {
    await say({
      text: "あなたのアクセス権限（部署）が未登録です。ナレッジ管理者に登録を依頼してください。",
      thread_ts: threadTs,
    });
    await logQuery(supabase, {
      slackUserId: event.user ?? "unknown",
      department: null,
      question,
      chunks: [],
      answerFound: false,
    });
    return;
  }

  // RAG検索+Claude生成に数秒〜十秒程度かかるため、先にプレースホルダーを投稿してから上書きする
  const placeholder = await say({ text: "検索中です…（数秒お待ちください）", thread_ts: threadTs });

  try {
    const chunks = await searchChunks(supabase, question, [userRow.department]);
    const { answer } = await generateAnswer(question, chunks);
    await client.chat.update({ channel: event.channel, ts: placeholder.ts!, text: answer });
    await logQuery(supabase, {
      slackUserId: event.user ?? "unknown",
      department: userRow.department,
      question,
      chunks,
      answerFound: !answer.includes(NOT_FOUND_MARKER),
    });
  } catch (err) {
    console.error(err);
    await client.chat.update({
      channel: event.channel,
      ts: placeholder.ts!,
      text: "検索中にエラーが発生しました。しばらくしてから再度お試しください。",
    });
  }
});

(async () => {
  await app.start();
  console.log("⚡️ Slack bot (Socket Mode) is running");
})();
