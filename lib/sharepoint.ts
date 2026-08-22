// SharePoint（Microsoft Graph API）連携。
// 実テナントの認証情報（Azure ADアプリ登録）がまだないため、この案件では未検証。
// 実運用時は SHAREPOINT_TENANT_ID / SHAREPOINT_CLIENT_ID / SHAREPOINT_CLIENT_SECRET /
// SHAREPOINT_DRIVE_ID / SHAREPOINT_FOLDER_PATH を環境変数に設定すれば動作する想定。

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function getAccessToken(): Promise<string> {
  const tenantId = process.env.SHAREPOINT_TENANT_ID;
  const clientId = process.env.SHAREPOINT_CLIENT_ID;
  const clientSecret = process.env.SHAREPOINT_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "SharePoint連携の環境変数が未設定です（SHAREPOINT_TENANT_ID / SHAREPOINT_CLIENT_ID / SHAREPOINT_CLIENT_SECRET）。実テナントのAzure ADアプリ登録が必要です。"
    );
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  if (!res.ok) {
    throw new Error(`SharePoint認証(client credentials flow)に失敗しました (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export type SharePointFile = {
  id: string;
  name: string;
  webUrl: string;
  lastModifiedDateTime: string;
  downloadUrl: string;
};

type GraphDriveItem = {
  id: string;
  name: string;
  webUrl: string;
  lastModifiedDateTime: string;
  "@microsoft.graph.downloadUrl"?: string;
};

// 指定日時以降に新規追加・更新されたPDFファイルを一覧する（フォルダ直下のみ。サブフォルダ対応は未実装）
export async function listNewOrUpdatedPdfFiles(sinceISO: string): Promise<SharePointFile[]> {
  const driveId = process.env.SHAREPOINT_DRIVE_ID;
  if (!driveId) {
    throw new Error("SHAREPOINT_DRIVE_ID が未設定です。対象SharePointサイトのドライブIDが必要です。");
  }
  const folderPath = process.env.SHAREPOINT_FOLDER_PATH ?? "";

  const token = await getAccessToken();
  const pathSegment = folderPath ? `root:/${folderPath}:` : "root";
  const url = `${GRAPH_BASE}/drives/${driveId}/${pathSegment}/children?$select=id,name,webUrl,lastModifiedDateTime`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`SharePointファイル一覧取得に失敗しました (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { value: GraphDriveItem[] };

  return json.value
    .filter((f) => f.name?.toLowerCase().endsWith(".pdf") && f.lastModifiedDateTime > sinceISO)
    .map((f) => ({
      id: f.id,
      name: f.name,
      webUrl: f.webUrl,
      lastModifiedDateTime: f.lastModifiedDateTime,
      downloadUrl: `${GRAPH_BASE}/drives/${driveId}/items/${f.id}/content`,
    }));
}

// 失敗ファイルの再試行時、保存済みの source_file / source_url / sharepoint_item_id から
// downloadFile()に渡せる形に復元する
export function reconstructFile(params: { name: string; webUrl: string; itemId: string }): SharePointFile {
  const driveId = process.env.SHAREPOINT_DRIVE_ID;
  if (!driveId) {
    throw new Error("SHAREPOINT_DRIVE_ID が未設定です。");
  }
  return {
    id: params.itemId,
    name: params.name,
    webUrl: params.webUrl,
    lastModifiedDateTime: "",
    downloadUrl: `${GRAPH_BASE}/drives/${driveId}/items/${params.itemId}/content`,
  };
}

export async function downloadFile(file: SharePointFile): Promise<Buffer> {
  const token = await getAccessToken();
  const res = await fetch(file.downloadUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`SharePointファイルのダウンロードに失敗しました (${file.name}, ${res.status})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
