/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Shared by Next routes and the internal metrics listener.
  serverExternalPackages: ["ioredis"],
  poweredByHeader: false,
};

module.exports = nextConfig;
