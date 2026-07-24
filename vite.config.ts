import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');

  return {
    base: env.VITE_BASE_PATH || '/',
    server: {
      port: 4173,
      strictPort: true,
      proxy: {
        '/tiles': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/tiles/, ''),
        },
        '/wms': {
          target: 'http://127.0.0.1:8080',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/wms/, ''),
        },
      },
    },
  };
});
