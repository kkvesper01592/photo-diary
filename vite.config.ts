import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { buildInfo } from './scripts/build-info.mjs'

// 本番ビルドだけに CSP を入れる(開発サーバーはインラインスクリプトを使うため)
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  'frame-src https://accounts.google.com/gsi/',
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

const cspPlugin = (): Plugin => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

// 公開先に version.json を置く(開いている画面が、新しい版が出たことに気づけるように)
const versionFile = (): Plugin => ({
  name: 'version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(buildInfo) })
  },
})

export default defineConfig({
  base: '/photo-diary/',
  plugins: [react(), cspPlugin(), versionFile()],
  define: { __BUILD_INFO__: JSON.stringify(buildInfo) },
  server: { port: 5175, strictPort: true },
})
