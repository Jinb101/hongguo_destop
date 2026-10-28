import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 上游直连只在桌面壳（Rust）里做，浏览器开发模式用这条反代保持同构：
// 路径与请求头都对齐 Rust 侧，保证 dev 里看到的数据和 exe 里一致。
const UPSTREAM = {
  target: 'https://api5-normal-sinfonlinea.fqnovel.com',
  changeOrigin: true,
  secure: true,
  rewrite: (p) => p.replace(/^\/upstream/, ''),
  headers: {
    'user-agent': 'okhttp/4.10.0',
    'x-tt-store-region': 'cn-sh',
    'x-tt-store-region-src': 'uid',
    'passport-sdk-version': '5051452',
    'sdk-version': '2',
  },
}

// Tauri 期望的产物目录：src-tauri/tauri.conf.json -> frontendDist
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    proxy: { '/upstream': UPSTREAM },
  },
  preview: {
    port: 4173,
    host: '127.0.0.1',
    proxy: { '/upstream': UPSTREAM },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: ['chrome110', 'safari14'],
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // 打成单一 JS chunk。
        //
        // 原因：Tauri v2 把前端资源编译进 exe 的 phf 资源表，
        // 资源 key 是编译期固定的（/index.html、/assets/index-XXX.css、/assets/index-XXX.js）。
        // 如果产出多个 chunk，就需要往资源表里额外注入 key，
        // 而 key 的字符串池是编译期生成的，无法在不改 Rust 源码的前提下新增。
        //
        // 所以这里关闭 manualChunks，让所有代码打进同一个 JS 文件，
        // 保证「一个 CSS + 一个 JS」的结构与原版一致。
        manualChunks: undefined,
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
