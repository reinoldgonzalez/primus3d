import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/primus3d/' : '/',
  build: { chunkSizeWarningLimit: 1500, target: 'es2020' },
  plugins: [VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png'],
    manifest: {
      name: 'Primus 3D', short_name: 'Primus 3D', description: 'Design rooms, homes and yards to exact size and show customers in 3D.', categories: ['productivity', 'business'], lang: 'en-US',
      theme_color: '#1f2933', background_color: '#1f2933', display: 'standalone', orientation: 'any', start_url: './', scope: './',
      icons: [{ src: 'pwa-192.png', sizes: '192x192', type: 'image/png' }, { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' }, { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
    },
    workbox: { globPatterns: ['**/*.{js,css,html,png,svg,mjs,woff2}'], globIgnores: ['splash/**', '**/heic2any*.js', 'tesseract/**'],
      runtimeCaching: [{ urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/(tesseract|@tesseract)/, handler: 'CacheFirst', options: { cacheName: 'ocr', expiration: { maxEntries: 20 } } }, { urlPattern: /\/tesseract\//, handler: 'CacheFirst', options: { cacheName: 'ocr-local', expiration: { maxEntries: 20 } } }, { urlPattern: /\/splash\/.*\.png$/, handler: 'CacheFirst', options: { cacheName: 'splash' } }], maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, navigateFallback: 'index.html' },
  })],
  server: { host: '0.0.0.0', port: 5180 }, preview: { host: '0.0.0.0', port: 5181 },
});
