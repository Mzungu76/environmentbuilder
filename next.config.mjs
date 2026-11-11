/** Static export: the app runs entirely in the browser (no server needed, deployable anywhere). */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  // docs/MANUALE.md is bundled as text and shown in the in-app manual page
  webpack: (config) => { config.module.rules.push({ test: /\.md$/, type: 'asset/source' }); return config; },
};
export default nextConfig;
