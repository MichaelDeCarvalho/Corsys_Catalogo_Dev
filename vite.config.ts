import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  // PR #6 intentionally does not ship the paid estimate-delivery Edge backend.
  // Fail the build instead of showing a checkout button that cannot work.
  if (loadEnv(mode, process.cwd(), 'VITE_').VITE_GOOGLE_ROUTES_UI_ENABLED === 'true') {
    throw new Error('RELEASE_BLOCKED_GOOGLE_ROUTES: backend not shipped; keep VITE_GOOGLE_ROUTES_UI_ENABLED=false');
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
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
