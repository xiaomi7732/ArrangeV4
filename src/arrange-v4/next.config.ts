import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.NODE_ENV === "production" ? "/ArrangeV4" : "",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
