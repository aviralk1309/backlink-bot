import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Lets pages call forbidden() and render app/**/forbidden.tsx.
  experimental: { authInterrupts: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The /admin redirect that was here is gone on purpose: the page at
  // src/app/(app)/admin/page.tsx sends each user to the first admin section
  // they may open, which a fixed redirect to /admin/users cannot do.
};

export default nextConfig;