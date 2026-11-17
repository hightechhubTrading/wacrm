import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, import.meta.dirname, 'VITE_'), ...process.env };
  const origin = (key) => {
    const url = new URL(env[key]);
    if (
      url.protocol !== 'https:' ||
      url.username || url.password || url.search || url.hash ||
      url.pathname !== '/'
    ) throw new Error(`${key} must be an HTTPS origin`);
    return url.origin;
  };
  const supabase = origin('VITE_SUPABASE_URL');
  const crm = origin('VITE_CRM_API_URL');
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    `connect-src 'self' ${supabase} ${supabase.replace(/^https:/, 'wss:')} ${crm}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    plugins: [{
      name: 'mobile-content-security-policy',
      transformIndexHtml: (html) => html.replace('__MOBILE_CSP__', policy),
    }],
  };
});
