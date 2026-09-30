/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The engine and core packages are TypeScript source, not published builds.
  transpilePackages: ['@finmanai/engine', '@finmanai/core'],
  typedRoutes: true,
  // Never expose these to the browser bundle.
  serverExternalPackages: ['@prisma/client'],
};
export default nextConfig;
