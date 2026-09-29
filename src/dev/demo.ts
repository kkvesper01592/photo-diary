// 開発サーバー専用のデモモード(?demo)。本番ビルドには含まれない。
//  - Google の代わりに架空のカレンダー・予定を返す
//  - 保存フォルダの代わりにブラウザ内の領域(OPFS)を使い、架空の写真を取り込み用フォルダに入れておく
//  - ?demo=reset で保存フォルダを空に戻す

const calendars = [
  { id: 'work@demo', summary: '仕事', backgroundColor: '#f09300', accessRole: 'owner', primary: true },
  { id: 'memo@demo', summary: '仕事メモ', backgroundColor: '#9a9cff', accessRole: 'owner' },
  { id: 'ja.japanese#holiday@group.v.calendar.google.com', summary: '日本の祝日', backgroundColor: '#16a765', accessRole: 'reader' },
]

const t = (s: string) => new Date(s).toISOString()
const events: Record<string, unknown[]> = {
  'work@demo': [
    { id: 'w1', summary: '現場A 点検', start: { dateTime: t('2026-09-03T10:00:00+09:00') }, end: { dateTime: t('2026-09-03T11:00:00+09:00') }, location: '東京駅前' },
    { id: 'w2', summary: '出張(大阪)', start: { date: '2026-09-14' }, end: { date: '2026-09-17' } },
    { id: 'w3', summary: '見積 打合せ', start: { dateTime: t('2026-09-15T09:30:00+09:00') }, end: { dateTime: t('2026-09-15T10:00:00+09:00') } },
    { id: 'w4', summary: '名古屋 作業', start: { dateTime: t('2026-09-29T13:00:00+09:00') }, end: { dateTime: t('2026-09-29T17:00:00+09:00') } },
  ],
  'memo@demo': [{ id: 'm1', summary: '現場Aの件 メモ', start: { date: '2026-09-03' }, end: { date: '2026-09-04' }, description: '点検の記録' }],
  'ja.japanese#holiday@group.v.calendar.google.com': [
    { id: 'h1', summary: '敬老の日', start: { date: '2026-09-21' }, end: { date: '2026-09-22' } },
    { id: 'h2', summary: '秋分の日', start: { date: '2026-09-23' }, end: { date: '2026-09-24' } },
  ],
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const log: string[] = []
;(window as unknown as { __demoLog: string[] }).__demoLog = log

export async function installDemo() {
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)
    const method = init?.method ?? 'GET'
    log.push(`${method} ${decodeURIComponent(url.pathname)}`)
    if (method !== 'GET') return json({ error: { message: 'demo: GET 以外は送らないはず' } }, 405)
    if (url.pathname.endsWith('/users/me/calendarList')) return json({ items: calendars })
    const m = /\/calendars\/([^/]+)\/events$/.exec(url.pathname)
    if (!m) return new Response('{}', { status: 404 })
    const min = new Date(url.searchParams.get('timeMin') ?? 0)
    const max = new Date(url.searchParams.get('timeMax') ?? '2100-01-01')
    const items = ((events[decodeURIComponent(m[1])] ?? []) as { start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string } }[]).filter((e) => {
      const s = new Date(e.start.dateTime ?? `${e.start.date}T00:00:00`)
      const en = new Date(e.end.dateTime ?? `${e.end.date}T00:00:00`)
      return s < max && en > min
    })
    return json({ items })
  }
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (cfg) => ({ requestAccessToken: () => cfg.callback({ access_token: 'demo', expires_in: 3600, scope: cfg.scope }) }),
        hasGrantedAllScopes: () => true,
        revoke: (_t, done) => done?.(),
      },
    },
  }

  // 保存フォルダ(ブラウザ内)
  const opfs = await navigator.storage.getDirectory()
  if (new URLSearchParams(location.search).get('demo') === 'reset') await opfs.removeEntry('demo-root', { recursive: true }).catch(() => {})
  const root = await opfs.getDirectoryHandle('demo-root', { create: true })
  const seeded = await root.getFileHandle('.seeded').then(
    () => true,
    () => false,
  )
  if (!seeded) {
    const inbox = await root.getDirectoryHandle('_取り込み', { create: true })
    const samples = import.meta.glob('./samples/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>
    for (const [path, src] of Object.entries(samples)) {
      const blob = await (await realFetch(src)).blob()
      const w = await (await inbox.getFileHandle(path.split('/').pop()!, { create: true })).createWritable()
      await w.write(blob)
      await w.close()
    }
    await root.getFileHandle('.seeded', { create: true })
  }
  window.__demoRoot = root
}
