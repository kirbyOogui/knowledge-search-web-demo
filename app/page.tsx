"use client";

import { useEffect, useRef, useState } from "react";

type Citation = {
  document_title: string;
  source_file: string;
  heading: string;
  page_start: number;
  page_end: number;
};

type Message = {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  department?: string;
};

const DEPARTMENTS = ["戦略", "人事", "IT", "営業"];

const SUGGESTIONS: Record<string, string[]> = {
  戦略: ["ROI試算を含む提案書はどれですか？", "DX推進提案の概要を教えてください"],
  人事: ["従業員エンゲージメントが最も低下する層はどこですか？", "エンゲージメント調査の結果を要約してください"],
  IT: ["クラウド移行でインフラ運用コストはどれだけ下がりましたか？", "クラウド移行のスケジュールは？"],
  営業: ["小売業向け提案の主な訴求ポイントは？", "この提案の見積もり金額は？"],
};

function getSessionId(): string {
  const key = "case7-web-session-id";
  let id = typeof window !== "undefined" ? sessionStorage.getItem(key) : null;
  if (!id) {
    id = crypto.randomUUID();
    if (typeof window !== "undefined") sessionStorage.setItem(key, id);
  }
  return id;
}

export default function Home() {
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendQuestion(question: string) {
    if (!question.trim() || loading) return;
    setError(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: question, department }]);
    setLoading(true);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, department, sessionId: getSessionId() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "エラーが発生しました。");
        setMessages((prev) => prev.slice(0, -1));
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.answer, citations: data.citations },
      ]);
    } catch {
      setError("通信エラーが発生しました。");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <header
        style={{
          padding: "18px 20px 14px",
          borderBottom: "1px solid #e3e5ea",
          background: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>ナレッジ検索AI</h1>
            <p style={{ fontSize: 12.5, color: "#6b7280", margin: "3px 0 0" }}>
              社内文書に基づいて回答します（Slack版と同じ検索エンジン・監査ログを使用）
            </p>
          </div>
          <label style={{ fontSize: 13, color: "#374151", display: "flex", alignItems: "center", gap: 6 }}>
            部署
            <select
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                setMessages([]);
              }}
              disabled={loading}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                fontSize: 13,
                background: "#fff",
              }}
            >
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}部
                </option>
              ))}
            </select>
          </label>
        </div>
        <p style={{ fontSize: 11.5, color: "#9ca3af", margin: "10px 0 0" }}>
          ※ 選択した部署の文書のみが検索対象になります（部署別アクセス制御のデモ）。全てサンプルデータです。
        </p>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {messages.length === 0 && (
          <div style={{ marginTop: 20 }}>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 10 }}>
              質問例（{department}部）：
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {SUGGESTIONS[department].map((s) => (
                <button
                  key={s}
                  onClick={() => sendQuestion(s)}
                  style={{
                    textAlign: "left",
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #e3e5ea",
                    background: "#fff",
                    fontSize: 13.5,
                    color: "#374151",
                    cursor: "pointer",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              marginBottom: 14,
            }}
          >
            <div
              style={{
                maxWidth: "80%",
                padding: "10px 14px",
                borderRadius: 14,
                fontSize: 14.5,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                background: m.role === "user" ? "#2563eb" : "#ffffff",
                color: m.role === "user" ? "#ffffff" : "#1a1d29",
                border: m.role === "user" ? "none" : "1px solid #e3e5ea",
              }}
            >
              {m.text}
              {m.citations && m.citations.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #eef0f3" }}>
                  {m.citations.map((c, ci) => (
                    <div key={ci} style={{ fontSize: 11.5, color: "#6b7280", marginTop: 2 }}>
                      📄 {c.source_file}（{c.document_title}）&gt; {c.heading} (p.{c.page_start}-{c.page_end})
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 14 }}>
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 14,
                background: "#ffffff",
                border: "1px solid #e3e5ea",
                fontSize: 13.5,
                color: "#9ca3af",
              }}
            >
              検索中…
            </div>
          </div>
        )}

        {error && (
          <p style={{ fontSize: 13, color: "#dc2626", textAlign: "center" }}>{error}</p>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendQuestion(input);
        }}
        style={{
          display: "flex",
          gap: 8,
          padding: "12px 20px calc(12px + env(safe-area-inset-bottom))",
          borderTop: "1px solid #e3e5ea",
          background: "#ffffff",
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="質問を入力…"
          maxLength={300}
          disabled={loading}
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #d1d5db",
            fontSize: 14.5,
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: loading || !input.trim() ? "#c7cbd1" : "#2563eb",
            color: "#fff",
            fontSize: 14.5,
            fontWeight: 600,
            cursor: loading || !input.trim() ? "default" : "pointer",
          }}
        >
          送信
        </button>
      </form>
    </main>
  );
}
