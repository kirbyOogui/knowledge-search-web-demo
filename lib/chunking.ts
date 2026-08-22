import { getEncoding } from "js-tiktoken";
import type { Section } from "./sections";

const encoding = getEncoding("cl100k_base");
const MAX_TOKENS = 1000;

function countTokens(text: string): number {
  return encoding.encode(text).length;
}

export type Chunk = {
  heading: string;
  content: string;
  pageStart: number;
  pageEnd: number;
};

// セクションが長大な場合（100ページ級の文書を想定）は段落単位でさらに分割する。
// 見出しは全サブチャンクに引き継ぎ、検索時に元のセクションが分かるようにする。
export function toChunks(sections: Section[]): Chunk[] {
  const chunks: Chunk[] = [];

  for (const section of sections) {
    if (countTokens(section.body) <= MAX_TOKENS) {
      chunks.push({
        heading: section.heading,
        content: section.body,
        pageStart: section.pageStart,
        pageEnd: section.pageEnd,
      });
      continue;
    }

    const paragraphs = section.body.split(/\n+/).filter((p) => p.trim().length > 0);
    let buffer: string[] = [];
    let bufferTokens = 0;

    const flush = () => {
      if (buffer.length === 0) return;
      chunks.push({
        heading: section.heading,
        content: buffer.join("\n"),
        pageStart: section.pageStart,
        pageEnd: section.pageEnd,
      });
      buffer = [];
      bufferTokens = 0;
    };

    for (const paragraph of paragraphs) {
      const t = countTokens(paragraph);
      if (bufferTokens + t > MAX_TOKENS && buffer.length > 0) flush();
      buffer.push(paragraph);
      bufferTokens += t;
    }
    flush();
  }

  return chunks;
}
