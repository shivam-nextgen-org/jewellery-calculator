import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tesseract.js uses workers / wasm — keep it external to the bundler
  serverExternalPackages: ["tesseract.js", "@napi-rs/canvas"],
  experimental: {
    // Design-sheet photos can be several MB
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
