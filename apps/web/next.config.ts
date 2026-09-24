import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Docker: ship only the traced server bundle instead of the whole workspace.
  output: "standalone",
  outputFileTracingRoot:
    process.env.NODE_ENV === "production" ? "../../" : undefined,
  experimental: {
    // @myflix/shared is workspace TypeScript, not a prebuilt package.
    externalDir: true,
  },
  images: {
    // Artwork is served by nginx straight out of MinIO with a long
    // immutable cache; Next's optimizer would only add a hop.
    unoptimized: true,
  },
};

export default config;
