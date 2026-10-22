import type { NextConfig } from "next";

const config: NextConfig = {
  // Static export: hosted on Cloudflare Pages, no server. Auth and API calls go from the
  // browser to Supabase and the Worker.
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@partspilot/shared"],
  images: { unoptimized: true },
};

export default config;
