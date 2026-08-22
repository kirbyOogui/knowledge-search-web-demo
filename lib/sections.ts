import type { PdfPage } from "./pdf";

export type Section = {
  heading: string;
  body: string;
  pageStart: number;
  pageEnd: number;
};

export type DocMeta = {
  title: string;
  department: string;
  clientName: string;
  createdYear: number | null;
  confidentiality: string;
};

type Line = { text: string; pageNumber: number };

// 「1. 案件概要」「1-1. 背景」「第3章 まとめ」のような見出しパターンを目印に
// セクション境界を検出する。本文の箇条書き行はこれらのプレフィックスを持たないため誤検出しにくい。
const HEADING_PATTERN = /^(?:第[0-9０-９]{1,3}章|[0-9０-９]{1,2}(?:-[0-9０-９]{1,2})?[.．])\s*(.{0,30})$/;

// 見出し検出だけで本文がほぼ空のセクション（誤検出・空見出し等）を除外する下限。
// 実際のセクションは短くても数十文字はあるため、100文字のような大きい値だと
// 案件7のサマリ版文書のような正当な短いセクション（例:「5. 期待効果」）まで失われてしまう。
const MIN_SECTION_BODY_LENGTH = 20;

function toLines(pages: PdfPage[]): Line[] {
  const lines: Line[] = [];
  for (const page of pages) {
    for (const raw of page.text.split("\n")) {
      const text = raw.trim();
      if (text.length > 0) lines.push({ text, pageNumber: page.pageNumber });
    }
  }
  return lines;
}

export function parseDocMeta(pages: PdfPage[]): DocMeta {
  const lines = toLines(pages);
  const metaLine = lines.find((l) => l.text.includes("部署:") && l.text.includes("客先:"));
  const titleLine = lines[0];

  const match = metaLine?.text.match(
    /部署:\s*([^\s/]+)\s*\/\s*客先:\s*([^\s/]+)\s*\/\s*作成:\s*(\d{4})年\s*\/\s*機密度:\s*([^\s/]+)/
  );

  return {
    title: titleLine?.text ?? "無題文書",
    department: match?.[1] ?? "不明",
    clientName: match?.[2] ?? "不明",
    createdYear: match ? Number(match[3]) : null,
    confidentiality: match?.[4] ?? "社外秘",
  };
}

export function extractSections(pages: PdfPage[]): Section[] {
  const lines = toLines(pages);
  const sections: Section[] = [];

  let current: { heading: string; bodyLines: Line[]; pageStart: number } | null = null;

  const flush = (endPageNumber: number) => {
    if (!current) return;
    const body = current.bodyLines.map((l) => l.text).join("\n");
    if (body.trim().length >= MIN_SECTION_BODY_LENGTH) {
      sections.push({
        heading: current.heading,
        body,
        pageStart: current.pageStart,
        pageEnd: endPageNumber,
      });
    }
  };

  let sawFirstHeading = false;
  for (const line of lines) {
    const headingMatch = line.text.match(HEADING_PATTERN);
    // 見出し行かどうかの判定には、番号+短文というパターンに加えて
    // 文末が句点で終わっていない（＝文章ではない）ことも条件にする
    const isHeading = !!headingMatch && !headingMatch[1].endsWith("。");

    if (isHeading) {
      sawFirstHeading = true;
      const prevLastPage = current?.bodyLines.at(-1)?.pageNumber ?? current?.pageStart ?? line.pageNumber;
      flush(prevLastPage);
      current = { heading: line.text, bodyLines: [], pageStart: line.pageNumber };
      continue;
    }

    // 最初の見出しより前（タイトル・部署メタ行・注記）はセクション化しない
    if (!sawFirstHeading) continue;

    current?.bodyLines.push(line);
  }

  const lastPage = current?.bodyLines.at(-1)?.pageNumber ?? current?.pageStart ?? pages.at(-1)?.pageNumber ?? 1;
  flush(lastPage);

  return sections;
}
