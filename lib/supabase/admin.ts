import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// service role keyでRLSをバイパスする管理用クライアント。
// ingest/eval スクリプト専用（Slack連携フェーズのAPIハンドラからは使わない）。
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      db: { schema: "case7" },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}
