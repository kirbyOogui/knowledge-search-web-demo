import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist（+ @napi-rs/canvasのネイティブバイナリ）はTurbopackでバンドルすると
  // DOMMatrix未定義エラーになるため、サーバーランタイムでそのままrequireさせる
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  // @napi-rs/canvasはpdfjs-dist内部からの動的requireのため、
  // 通常のoutput file tracingでは検出されずデプロイパッケージから漏れる。明示的に含める。
  outputFileTracingIncludes: {
    "/api/cron/sharepoint-sync": [
      "./node_modules/@napi-rs/canvas/**",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
    ],
  },
};

export default nextConfig;
