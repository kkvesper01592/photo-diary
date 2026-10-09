// アプリ本体(画面のプログラム)だけをキャッシュする。写真・予定のデータは一切キャッシュしない。
const CACHE = 'photodiary-shell-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  // 自分のサイト以外(Google など)は触らない
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    const cached = () => caches.match(req).then((r) => r || caches.match('./'))
    // ページ本体: まずネットから最新を取り、つながらない時だけキャッシュ
    e.respondWith(
      fetch(req)
        .then((res) => {
          // 公開先が止まっている時(404 など)は保存済みのアプリで開き、エラーのページで上書きしない
          if (!res.ok) return cached().then((r) => r || res)
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
          return res
        })
        .catch(() => cached()),
    )
    return
  }

  if (url.pathname.includes('/assets/') || /\.(png|webmanifest)$/.test(url.pathname)) {
    // ファイル名にハッシュが付いた JS/CSS とアイコン: キャッシュ優先
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
  }
})
