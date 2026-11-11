/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg', 'exceljs', '@electric-sql/pglite'],
  poweredByHeader: false,
  async headers() {
    const security = [
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ];
    return [
      { source: '/:path*', headers: security },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};
export default nextConfig;
