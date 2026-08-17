import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow mobile browser testing on local network IP and HTTPS tunnels in development
  allowedDevOrigins: [
    "192.168.1.2",
    "localhost",
    "127.0.0.1",
    "silent-seals-repeat.loca.lt",
    "*.loca.lt",
    "*.trycloudflare.com",
  ],
};

export default nextConfig;
