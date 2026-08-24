import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.REYO_NATIVE_BUILD === '1' ? { output: 'export' as const } : {}),
  // Allow mobile browser testing on local network IP and HTTPS tunnels in development
  allowedDevOrigins: [
    "192.168.1.2",
    "localhost",
    "127.0.0.1",
    "silent-seals-repeat.loca.lt",
    "*.loca.lt",
    "*.trycloudflare.com",
  ],
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=()" },
      ],
    }];
  },
};

export default nextConfig;
