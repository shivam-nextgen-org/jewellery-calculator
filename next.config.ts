import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build a self-contained Node server at .next/standalone/server.js for
  // Docker / VPS deployment (run with `node server.js`).
  output: "standalone",
  // tesseract.js uses workers / wasm — keep it external to the bundler
  serverExternalPackages: [
    "tesseract.js",
    "@napi-rs/canvas",
    "node-cron",
    "mongodb",
  ],
  experimental: {
    // Design-sheet photos can be several MB
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
