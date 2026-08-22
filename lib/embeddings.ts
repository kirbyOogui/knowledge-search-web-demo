const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3";
export const EMBEDDING_DIMENSION = 1024;

type VoyageResponse = {
  data: { embedding: number[]; index: number }[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embed(
  texts: string[],
  inputType: "document" | "query",
  attempt = 1
): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "VOYAGE_API_KEYが設定されていません。.env.localにVoyage AIのAPIキーを設定してください。"
    );
  }

  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: inputType,
      output_dimension: EMBEDDING_DIMENSION,
    }),
  });

  if (res.status === 429 && attempt <= 5) {
    // 支払い方法未設定だと3 RPMに制限されるため、間隔を空けてリトライする
    const waitMs = 20000 * attempt;
    console.log(`  - Voyage AIレート制限(429)。${waitMs / 1000}秒待ってリトライします (${attempt}/5)`);
    await sleep(waitMs);
    return embed(texts, inputType, attempt + 1);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Voyage AI Embedding APIエラー (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as VoyageResponse;
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  return embed(texts, "document");
}

export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embed([text], "query");
  return embedding;
}
