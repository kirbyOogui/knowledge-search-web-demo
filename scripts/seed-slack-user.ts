// Slackユーザー ⇔ 部署のマッピングを登録する簡易CLI。
// 使い方: npm run seed-slack-user -- <slack_user_id> <department> [display_name]
import { createAdminClient } from "../lib/supabase/admin";

async function main() {
  const [slackUserId, department, displayName] = process.argv.slice(2);
  if (!slackUserId || !department) {
    console.log("使い方: npm run seed-slack-user -- <slack_user_id> <department> [display_name]");
    process.exit(1);
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("slack_users")
    .upsert({ slack_user_id: slackUserId, department, display_name: displayName ?? null });

  if (error) throw error;
  console.log(`登録しました: ${slackUserId} → 部署「${department}」`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
