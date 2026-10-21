// 専用アプリ(Windows の WebCalendar.exe・PhotoDiary.exe・Kakeibo.exe = WebCalendarDesktop)の中で動いているときの、アプリ本体とのやり取り。
// ブラウザで開いたときは何もしない(inDesktopApp が false)。
// アプリの中では、ブラウザの保存場所(localStorage・IndexedDB)の代わりに、アプリ本体が
// %LOCALAPPDATA%\WebCalendarApp に DPAPI で暗号化して保存する(Chrome の「閉じたら削除」などの影響を受けない)。

interface WebViewBridge {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void
  hostObjects: { sync: { desktop?: DesktopSync } }
}
/** 同期で呼べるアプリ本体の窓口(起動時に設定を読むためだけに使う) */
interface DesktopSync {
  GetLocalStorage(): string
  HasLogin(): boolean
  Version(): string
}

const webview = (window as unknown as { chrome?: { webview?: WebViewBridge } }).chrome?.webview
const desktopSync = (() => {
  try {
    return webview?.hostObjects?.sync?.desktop
  } catch {
    return undefined
  }
})()

/** 専用アプリの中で動いているか */
export const inDesktopApp = !!webview && !!desktopSync

/** 専用アプリにログインの合鍵(リフレッシュトークン)が保存されているか */
export const desktopHasLogin = (): boolean => {
  try {
    return inDesktopApp && !!desktopSync!.HasLogin()
  } catch {
    return false
  }
}

/** 専用アプリ本体の版(画面の「このアプリについて」に出す) */
export const desktopVersion = (): string => {
  try {
    return inDesktopApp ? String(desktopSync!.Version()) : ''
  } catch {
    return ''
  }
}

// ---- 非同期のやり取り(要求に番号を付け、同じ番号の返事を待つ) ----
interface Reply {
  id: number
  ok: boolean
  result?: unknown
  error?: string
  errorName?: string // 'NotFoundError' / 'AbortError' / 'NetworkError' など
}
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
webview?.addEventListener('message', (e) => {
  const m = e.data as Reply
  const p = m && pending.get(m.id)
  if (!p) return
  pending.delete(m.id)
  if (m.ok) return p.resolve(m.result)
  // 通信できなかったときは、ブラウザの fetch の失敗と同じ形にする(オフライン表示への切り替えに使われる)
  if (m.errorName === 'NetworkError') return p.reject(new TypeError(`Failed to fetch (${m.error ?? 'network'})`))
  p.reject(m.errorName ? new DOMException(m.error ?? '', m.errorName) : new Error(m.error ?? 'アプリ本体でエラーが起きました'))
})

export function hostCall<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!webview) return Promise.reject(new Error('専用アプリの中ではありません'))
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    webview.postMessage({ id, method, args })
  })
}

// ---- localStorage の代わり(起動時に全部読み込み、変えたらすぐアプリ本体に保存) ----
class HostStorage {
  #map: Map<string, string>
  constructor(initial: Record<string, string>) {
    this.#map = new Map(Object.entries(initial))
  }
  get length() {
    return this.#map.size
  }
  key(i: number) {
    return [...this.#map.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.#map.has(k) ? this.#map.get(k)! : null
  }
  setItem(k: string, v: string) {
    const s = String(v)
    if (this.#map.get(k) === s) return
    this.#map.set(k, s)
    this.#save()
  }
  removeItem(k: string) {
    if (this.#map.delete(k)) this.#save()
  }
  clear() {
    this.#map.clear()
    this.#save()
  }
  #save() {
    webview?.postMessage({ id: 0, method: 'ls.save', args: { json: JSON.stringify(Object.fromEntries(this.#map)) } })
  }
}

// ---- フォルダの読み書き(File System Access API と同じ形。許可の確認画面は出ない) ----
const join = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, '')}\\${name}`
const notFound = (path: string) => new DOMException(`見つかりません: ${path}`, 'NotFoundError')

interface Entry {
  name: string
  kind: 'file' | 'directory'
}

export class HostDirHandle {
  readonly kind = 'directory' as const
  readonly name: string
  constructor(readonly path: string) {
    this.name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
  }
  /** 端末の保存(kv)に入れるときの形 */
  toJSON() {
    return { __hostDir: this.path }
  }
  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}) {
    const p = join(this.path, name)
    if (!(await hostCall<boolean>('fs.dir', { path: p, create: !!opts.create }))) throw notFound(p)
    return new HostDirHandle(p)
  }
  async getFileHandle(name: string, opts: { create?: boolean } = {}) {
    const p = join(this.path, name)
    if (!(await hostCall<boolean>('fs.file', { path: p, create: !!opts.create }))) throw notFound(p)
    return new HostFileHandle(p, name)
  }
  async removeEntry(name: string, opts: { recursive?: boolean } = {}) {
    await hostCall('fs.remove', { path: join(this.path, name), recursive: !!opts.recursive })
  }
  async *entries(): AsyncGenerator<[string, HostDirHandle | HostFileHandle]> {
    const list = await hostCall<Entry[]>('fs.list', { path: this.path })
    for (const e of list) {
      const p = join(this.path, e.name)
      yield [e.name, e.kind === 'directory' ? new HostDirHandle(p) : new HostFileHandle(p, e.name)]
    }
  }
  async *keys() {
    for await (const [name] of this.entries()) yield name
  }
  async *values() {
    for await (const [, h] of this.entries()) yield h
  }
  [Symbol.asyncIterator]() {
    return this.entries()
  }
  async queryPermission() {
    return 'granted' as const
  }
  async requestPermission() {
    return 'granted' as const
  }
  async isSameEntry(other: { path?: string }) {
    return other?.path?.toLowerCase() === this.path.toLowerCase()
  }
}

export class HostFileHandle {
  readonly kind = 'file' as const
  constructor(
    readonly path: string,
    readonly name: string,
  ) {}
  async getFile() {
    const r = await hostCall<{ base64: string; size: number; lastModified: number }>('fs.read', { path: this.path })
    const bin = atob(r.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new File([bytes], this.name, { lastModified: r.lastModified })
  }
  async createWritable(opts: { keepExistingData?: boolean } = {}) {
    const path = this.path
    let start: number | null = null // seek した位置(keepExistingData のとき)
    const parts: BlobPart[] = [] // 文字・写真などのバイナリをそのまま集める
    return {
      async seek(pos: number) {
        start = pos
      },
      async write(data: BlobPart | { type: 'write'; data: BlobPart }) {
        parts.push(data && typeof data === 'object' && 'type' in data && (data as { type: string }).type === 'write' ? (data as { data: BlobPart }).data : (data as BlobPart))
      },
      async close() {
        await hostCall('fs.write', { path, base64: await toBase64(new Blob(parts)), keep: !!opts.keepExistingData, start })
      },
      async abort() {
        parts.length = 0
      },
    }
  }
  async queryPermission() {
    return 'granted' as const
  }
  async requestPermission() {
    return 'granted' as const
  }
}

/** Blob を base64 にする(アプリ本体へ渡すため。文字は UTF-8 になる) */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** kv に保存した値を戻すとき、フォルダは HostDirHandle に戻す */
export const reviveHost = (_k: string, v: unknown) =>
  v && typeof v === 'object' && '__hostDir' in v ? new HostDirHandle(String((v as { __hostDir: string }).__hostDir)) : v

/** アプリの中で動いているときだけ、ブラウザの保存場所とフォルダ選択をアプリ本体に差し替える(ほかのモジュールより先に読み込む) */
export function installDesktopHost() {
  if (!inDesktopApp) return
  let initial: Record<string, string> = {}
  try {
    initial = JSON.parse(desktopSync!.GetLocalStorage() || '{}')
  } catch {
    /* 空から始める */
  }
  const storage = new HostStorage(initial)
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
  const pick = async (opts?: { id?: string; mode?: string }) => {
    const r = await hostCall<{ path: string } | null>('fs.pick', { id: opts?.id ?? '', mode: opts?.mode ?? 'read' })
    if (!r) throw new DOMException('フォルダの選択をやめました', 'AbortError')
    return new HostDirHandle(r.path)
  }
  Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: pick })
  document.documentElement.dataset.desktop = '1'
}
