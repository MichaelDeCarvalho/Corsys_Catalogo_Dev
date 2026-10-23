import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  // Google can be exposed ONLY in a deliberately selected local Supabase QA build.
  // Production builds (including AI Studio / Cloudflare) remain fail-closed.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (env.VITE_GOOGLE_ROUTES_UI_ENABLED === 'true') {
    const localQa = mode === 'homologation' &&
      env.VITE_CORSYS_HOMOLOGATION_APPROVED === 'true' &&
      ['http://127.0.0.1:54321', 'http://localhost:54321'].includes(
        (env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
      );
    if (!localQa) {
      throw new Error('RELEASE_BLOCKED_GOOGLE_ROUTES: only isolated localhost homologation builds may enable routing UI');
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: [
        'localhost',
        '127.0.0.1',
        'ais-dev-qqcnhyqbvjuzriq524b4mp-465974179791.us-west1.run.app',
        'ais-pre-qqcnhyqbvjuzriq524b4mp-465974179791.us-west1.run.app',
      ],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
