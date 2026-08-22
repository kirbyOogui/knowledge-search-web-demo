import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const NOT_FOUND_MARKER = "該当する情報が見つかりません";

export type RetrievedChunk = {
  id: string;
  content: string;
  heading: string;
  document_title: string;
  source_file: string;
  source_url: string | null;
  department: string;
  page_start: number;
  page_end: number;
  similarity: number;
};

export type Citation = {
  document_title: string;
  source_file: string;
  source_url: string | null;
  heading: string;
  page_start: number;
  page_end: number;
};

export type AnswerResult = {
  answer: string;
  citations: Citation[];
};

const SYSTEM_PROMPT = `あなたはコンサルティング会社のナレッジ検索AIアシスタントです。以下のルールを厳守してください。

1. 提供された「参考文書」に書かれている内容のみを根拠に回答してください。参考文書にない情報を推測や一般知識で補ってはいけません。
2. 参考文書に質問への回答が見つからない場合は、必ず「${NOT_FOUND_MARKER}」とだけ回答し、それらしい推測をしないでください。
3. 回答できる場合は、回答の最後に空行を挟んで「出典:」として、根拠にした参考文書の**ファイル名**・タイトル・章見出し・ページ範囲を必ず列挙してください（例: 出典: case7-doc1-strategy-dx-bank.pdf（銀行A向けDX推進提案書）> 4. ROI試算 (p.1)）。ファイル名は必ず含めること。
4. 簡潔に、日本語で回答してください。`;

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((c) => {
    const key = `${c.source_file}#${c.heading}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function generateAnswer(
  question: string,
  chunks: RetrievedChunk[]
): Promise<AnswerResult> {
  if (chunks.length === 0) {
    return { answer: `${NOT_FOUND_MARKER}。`, citations: [] };
  }

  const context = chunks
    .map((c, i) => {
      const urlLine = c.source_url ? `\nURL: ${c.source_url}` : "";
      return `[参考文書${i + 1}] ${c.source_file}（${c.document_title}） > ${c.heading} (p.${c.page_start}-${c.page_end})${urlLine}\n${c.content}`;
    })
    .join("\n\n---\n\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `# 参考文書\n\n${context}\n\n# 質問\n\n${question}`,
      },
    ],
  });

  const answer = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  const citations = answer.includes(NOT_FOUND_MARKER)
    ? []
    : dedupeCitations(
        chunks.map((c) => ({
          document_title: c.document_title,
          source_file: c.source_file,
          source_url: c.source_url,
          heading: c.heading,
          page_start: c.page_start,
          page_end: c.page_end,
        }))
      );

  return { answer, citations };
}
