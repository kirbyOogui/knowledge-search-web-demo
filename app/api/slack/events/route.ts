import crypto from "node:crypto";
import { after } from "next/server";
import { WebClient } from "@slack/web-api";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { searchChunks } from "../../../../lib/search";
import { generateAnswer, NOT_FOUND_MARKER } from "../../../../lib/claude";
import { logQuery } from "../../../../lib/query-log";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const supabase = createAdminClient();

const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

function isValidSlackSignature(rawBody: string, timestamp: string, signature: string): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET!;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (Number.isNaN(age) || age > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto.createHmac("sha256", signingSecret).update(base).digest("hex")}`;

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function stripMention(text: string): string {
  return text.replace(/<@[^>]+>/g, "").trim();
}

type AppMentionEvent = {
  type: "app_mention";
  user: string;
  text: string;
  channel: string;
  ts: string;
  thread_ts?: string;
};

async function handleAppMention(event: AppMentionEvent, receivedAt: number) {
  const question = stripMention(event.text);
  const threadTs = event.thread_ts ?? event.ts;

  if (!question) {
    await slack.chat.postMessage({
      channel: event.channel,
      thread_ts: threadTs,
      text: "質問内容を書いてください。例: `@knowledge ROI試算のある提案書はどれ？`",
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
    await slack.chat.postMessage({
      channel: event.channel,
      thread_ts: threadTs,
      text: "内部エラーが発生しました。しばらくしてから再度お試しください。",
    });
    return;
  }

  if (!userRow) {
    await slack.chat.postMessage({
      channel: event.channel,
      thread_ts: threadTs,
      text: "あなたのアクセス権限（部署）が未登録です。ナレッジ管理者に登録を依頼してください。",
    });
    await logQuery(supabase, {
      slackUserId: event.user,
      department: null,
      question,
      chunks: [],
      answerFound: false,
    });
    return;
  }

  const placeholder = await slack.chat.postMessage({
    channel: event.channel,
    thread_ts: threadTs,
    text: "検索中です…（数秒お待ちください）",
  });

  try {
    const chunks = await searchChunks(supabase, question, [userRow.department]);
    const { answer } = await generateAnswer(question, chunks);
    await slack.chat.update({ channel: event.channel, ts: placeholder.ts!, text: answer });
    console.log(`[latency] final answer posted after ${Date.now() - receivedAt}ms`);
    await logQuery(supabase, {
      slackUserId: event.user,
      department: userRow.department,
      question,
      chunks,
      answerFound: !answer.includes(NOT_FOUND_MARKER),
    });
  } catch (err) {
    console.error(err);
    await slack.chat.update({
      channel: event.channel,
      ts: placeholder.ts!,
      text: "検索中にエラーが発生しました。しばらくしてから再度お試しください。",
    });
  }
}

export async function POST(req: Request) {
  const receivedAt = Date.now();
  const rawBody = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
  const signature = req.headers.get("x-slack-signature") ?? "";

  if (!isValidSlackSignature(rawBody, timestamp, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const body = JSON.parse(rawBody);

  // Slack URL Verification（Event Subscriptions有効化時の疎通確認）
  if (body.type === "url_verification") {
    return Response.json({ challenge: body.challenge });
  }

  // 3秒以内に応答しないとSlackがリトライ（=重複処理の原因）するため、
  // 検索・回答生成はawaitせず即座にACKする。
  // Vercelのサーバーレス関数はレスポンス送信と同時に実行環境を凍結するため、
  // 単にawaitしないだけでは処理が完了前に打ち切られる。next/serverのafter()で
  // レスポンス後もこの処理が完了するまで実行環境を維持させる。
  if (body.event?.type === "app_mention" && !req.headers.get("x-slack-retry-num")) {
    after(() => handleAppMention(body.event as AppMentionEvent, receivedAt).catch(console.error));
  }

  console.log(`[latency] ack after ${Date.now() - receivedAt}ms`);
  return new Response("OK");
}
