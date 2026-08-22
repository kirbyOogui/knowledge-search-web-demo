import "./globals.css";

export const metadata = {
  title: "ナレッジ検索AI",
  description: "社内文書に基づいて質問に回答するAIアシスタント（Slack連携版と同じ検索エンジンを使用）",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
