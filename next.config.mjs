/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Agencies' logo URLs are arbitrary; allow remote images in the branded UI.
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
};

export default nextConfig;
