import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfPage = {
  pageNumber: number;
  text: string;
};

export async function extractPdfPages(fileBuffer: Buffer): Promise<PdfPage[]> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer) });
  const doc = await loadingTask.promise;

  const pages: PdfPage[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();

    let text = "";
    for (const item of content.items) {
      if ("str" in item) {
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
    }

    // 一部PDFのフォントでは「行」「用」等の常用漢字がKangxi Radicals（部首）の
    // 互換文字として抽出されることがあり、そのままだとEmbeddingの意味理解が大きく損なわれる。
    // NFKC正規化で通常のCJK統合漢字に変換する。
    pages.push({ pageNumber, text: text.trim().normalize("NFKC") });
  }

  await loadingTask.destroy();
  return pages;
}
