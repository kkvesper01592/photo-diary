import { getDir, getFile, listEntries, readText, writeBlob } from './fs'
import { idbGet, idbSet } from '../lib/idb'
import {
  DATA_DIR,
  DAY_FILE,
  EVENTS_FILE,
  EVENTS_PREV_FILE,
  MEMO_BACKUP_DIR,
  MEMO_HISTORY_MAX,
  captionsOf,
  type MemoHistory,
  type MemoVersion,
  DEFAULT_SETTINGS,
  INBOX,
  INDEX_FILE,
  REDUCED_DIR,
  SETTINGS_FILE,
  SETTINGS_HISTORY_DIR,
  SETTINGS_HISTORY_MAX,
  THUMB_DIR,
  derivedName,
  emptyDay,
  summarize,
  type DayData,
  type Settings,
  type YearIndex,
} from './model'


export type PhotoKind = 'thumb' | 'reduced' | 'original'

/** 保存のときに履歴へ残すか(updateDay を参照) */
export interface HistoryMode {
  before?: boolean
  after?: boolean
}

const sameContent = (a: { memo: string; captions: Record<string, string> }, b: { memo: string; captions: Record<string, string> }) =>
  a.memo === b.memo && JSON.stringify(a.captions) === JSON.stringify(b.captions)

/** 別の PC で先にメモが変更されていた */
export class ConflictError extends Error {
  constructor(public latest: DayData) {
    super('ほかの PC で先に変更されています')
  }
}

function parseJson<T>(text: string | undefined, name: string): T | undefined {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${name} の内容が壊れているため読めません`)
  }
}

const yearOf = (date: string) => date.slice(0, 4)
const SETTINGS_IDB_KEY = 'settings'

/** 保存フォルダの読み書きをまとめたもの */
export class Library {
  private urls = new Map<string, string>()
  private queue: Promise<unknown> = Promise.resolve()
  private settingsHistoryChecked = false

  /** 書き込みを1つずつ順番に行う(同じファイルへの同時書き込みで内容が混ざらないように) */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }

  constructor(public root: FileSystemDirectoryHandle) {}

  get rootName() {
    return this.root.name
  }

  // ---- 設定 ----
  /**
   * 設定は3か所に控える: 保存フォルダの 写真日記_設定.json(本体)・設定の履歴(変える前の設定を日時付きで)・ブラウザ。
   * 本体が無い・壊れているときは、設定の履歴の新しいもの → ブラウザの控え の順に探して戻す。
   * restored: どこから戻したか(戻していなければ undefined)
   */
  async loadSettings(): Promise<Settings & { restored?: string }> {
    let main: Partial<Settings> | undefined
    try {
      main = parseJson<Partial<Settings>>(await readText(this.root, SETTINGS_FILE), SETTINGS_FILE)
    } catch {
      main = undefined // 壊れていたら控えから戻す
    }
    if (main) {
      const s = { ...DEFAULT_SETTINGS, ...main }
      await idbSet(SETTINGS_IDB_KEY, s).catch(() => {})
      // 控えがまだ1つも無ければ、今の設定を控える(この機能より前から使っている場合)
      if (!this.settingsHistoryChecked) {
        this.settingsHistoryChecked = true
        if (!(await this.listSettingsHistory()).length) await this.serial(() => this.addSettingsHistory(JSON.stringify(s, null, 2))).catch(() => {})
      }
      return s
    }
    const fromHistory = await this.latestSettingsHistory()
    const fromBrowser = await idbGet<Settings>(SETTINGS_IDB_KEY)
    const pick = fromHistory ?? fromBrowser
    if (!pick) return { ...DEFAULT_SETTINGS }
    const s = { ...DEFAULT_SETTINGS, ...pick }
    await this.serial(() => writeBlob(this.root, SETTINGS_FILE, JSON.stringify(s, null, 2))).catch(() => {})
    return { ...s, restored: fromHistory ? '保存フォルダの設定の履歴' : 'ブラウザの控え' }
  }

  saveSettings(s: Settings) {
    return this.serial(async () => {
      const { restored: _r, ...clean } = s as Settings & { restored?: string }
      const text = JSON.stringify(clean, null, 2)
      // 履歴がまだ無ければ、今までの設定を最初の1件として控える
      const cur = await readText(this.root, SETTINGS_FILE).catch(() => undefined)
      if (cur && cur.trim() !== text && !(await this.listSettingsHistory()).length) await this.addSettingsHistory(cur, new Date(Date.now() - 1000))
      await writeBlob(this.root, SETTINGS_FILE, text)
      // 保存した設定を履歴にも控える(本体が消えても、いちばん新しい設定を戻せるように)
      await this.addSettingsHistory(text)
      await idbSet(SETTINGS_IDB_KEY, clean).catch(() => {})
    })
  }

  private async addSettingsHistory(text: string, d = new Date()) {
    const dir = (await getDir(this.root, [DATA_DIR, SETTINGS_HISTORY_DIR], true))!
    const p = (n: number) => String(n).padStart(2, '0')
    const name = `設定_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`
    await writeBlob(dir, name, text)
    // 古いものから整理(最新 SETTINGS_HISTORY_MAX 件を残す)
    const files = (await listEntries(dir)).filter((e) => e.kind === 'file' && /^設定_\d{8}_\d{6}\.json$/.test(e.name)).map((e) => e.name).sort()
    for (const old of files.slice(0, Math.max(0, files.length - SETTINGS_HISTORY_MAX))) await dir.removeEntry(old).catch(() => {})
  }

  /** 設定の履歴(新しい順)。name は 設定_YYYYMMDD_HHMMSS.json */
  async listSettingsHistory(): Promise<{ name: string; label: string }[]> {
    const dir = await getDir(this.root, [DATA_DIR, SETTINGS_HISTORY_DIR], false)
    if (!dir) return []
    return (await listEntries(dir))
      .filter((e) => e.kind === 'file' && /^設定_\d{8}_\d{6}\.json$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse()
      .map((name) => {
        const m = /(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(name)!
        return { name, label: `${m[1]}/${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}:${m[6]} に保存した設定` }
      })
  }

  async loadSettingsHistory(name: string): Promise<Settings> {
    const dir = await getDir(this.root, [DATA_DIR, SETTINGS_HISTORY_DIR], false)
    const v = dir && parseJson<Partial<Settings>>(await readText(dir, name), name)
    if (!v) throw new Error('設定の履歴が見つかりません')
    return { ...DEFAULT_SETTINGS, ...v }
  }

  private async latestSettingsHistory(): Promise<Partial<Settings> | undefined> {
    const dir = await getDir(this.root, [DATA_DIR, SETTINGS_HISTORY_DIR], false)
    if (!dir) return undefined
    const files = (await listEntries(dir)).filter((e) => e.kind === 'file' && /^設定_\d{8}_\d{6}\.json$/.test(e.name)).map((e) => e.name).sort().reverse()
    for (const f of files) {
      try {
        const v = parseJson<Partial<Settings>>(await readText(dir, f), f)
        if (v) return v
      } catch {
        /* 壊れていたら次に古いもの */
      }
    }
    return undefined
  }

  /** 初回: 取り込み用フォルダを用意する */
  async ensureInbox(): Promise<FileSystemDirectoryHandle> {
    return (await getDir(this.root, [INBOX], true))!
  }

  // ---- 日ごとのデータ ----
  dayDir(date: string, create: boolean) {
    return getDir(this.root, [yearOf(date), date], create)
  }

  async loadDay(date: string): Promise<DayData> {
    const dir = await this.dayDir(date, false)
    if (!dir) return emptyDay(date)
    const d = parseJson<DayData>(await readText(dir, DAY_FILE), `${date}/${DAY_FILE}`)
    return d ? { ...emptyDay(date), ...d } : emptyDay(date)
  }

  /**
   * 最新の内容を読み直してから変更を当てて保存する(ほかの PC の変更を消さないため)。
   * change は最新の内容を受け取り、書き換える。false を返すと保存しない
   */
  updateDay(date: string, change: (d: DayData) => void | false, history: HistoryMode = {}): Promise<DayData> {
    return this.serial(() => this.updateDayNow(date, change, history))
  }

  /**
   * history.before: 変更前の内容を履歴に残す(削除・説明を消す・履歴から戻すなど、内容が消える操作)
   * history.after: 変更後の内容を履歴に残す(「保存」ボタン)
   * どちらも無い(自動保存): 履歴には残さない
   */
  private async updateDayNow(date: string, change: (d: DayData) => void | false, history: HistoryMode = {}): Promise<DayData> {
    const latest = await this.loadDay(date)
    const before = { savedAt: latest.updatedAt, memo: latest.memo, captions: captionsOf(latest) }
    if (change(latest) === false) return latest
    latest.updatedAt = new Date().toISOString()
    const now = { savedAt: latest.updatedAt, memo: latest.memo, captions: captionsOf(latest) }
    // 先に履歴へ控えてから日記.json を書き換える(書き換えの途中で失敗しても、前の内容が履歴に残る)
    if (history.before && !sameContent(before, now)) await this.appendVersion(date, before)
    const dir = (await this.dayDir(date, true))!
    await writeBlob(dir, DAY_FILE, JSON.stringify(latest, null, 2))
    await this.updateIndex(date, latest)
    if (history.after) await this.appendVersion(date, now)
    return latest
  }

  // ---- メモ・説明の履歴(写真の削除などの操作では消さない控え) ----
  private memoHistoryDir(date: string, create: boolean) {
    return getDir(this.root, [DATA_DIR, MEMO_BACKUP_DIR, yearOf(date)], create)
  }

  async loadMemoHistory(date: string): Promise<MemoHistory> {
    const dir = await this.memoHistoryDir(date, false)
    const h = dir && parseJson<MemoHistory>(await readText(dir, `${date}.json`), `${MEMO_BACKUP_DIR}/${date}.json`)
    return h ?? { version: 1, date, versions: [] }
  }

  /** 履歴に1件追加する。空の内容・直前と同じ内容は追加しない */
  private async appendVersion(date: string, v: MemoVersion) {
    if (!v.memo.trim() && !Object.keys(v.captions).length) return
    const h = await this.loadMemoHistory(date)
    const last = h.versions[h.versions.length - 1]
    if (last && sameContent(last, v)) return
    h.versions.push({ ...v, savedAt: v.savedAt || new Date().toISOString() })
    if (h.versions.length > MEMO_HISTORY_MAX) h.versions = h.versions.slice(-MEMO_HISTORY_MAX)
    const dir = (await this.memoHistoryDir(date, true))!
    await writeBlob(dir, `${date}.json`, JSON.stringify(h, null, 2))
  }

  /** 「保存」ボタン: 今保存されている内容を履歴に残す(直前の履歴と同じなら何もしない) */
  recordHistory(date: string): Promise<void> {
    return this.serial(async () => {
      const d = await this.loadDay(date)
      await this.appendVersion(date, { savedAt: new Date().toISOString(), memo: d.memo, captions: captionsOf(d) })
    })
  }

  // ---- 予定の控え(ブラウザのデータが消えても、ここから戻せる) ----
  async loadEventsBackup<T>(): Promise<T | undefined> {
    const dir = await getDir(this.root, [DATA_DIR], false)
    if (!dir) return undefined
    for (const name of [EVENTS_FILE, EVENTS_PREV_FILE]) {
      try {
        const v = parseJson<T>(await readText(dir, name), name)
        if (v) return v
      } catch {
        /* 壊れていたら前回の控えを使う */
      }
    }
    return undefined
  }

  /** 予定の控えを保存(今の控えは「前回」として1つ残す) */
  saveEventsBackup(data: unknown) {
    return this.serial(async () => {
      const dir = (await getDir(this.root, [DATA_DIR], true))!
      const cur = await readText(dir, EVENTS_FILE)
      if (cur) await writeBlob(dir, EVENTS_PREV_FILE, cur)
      await writeBlob(dir, EVENTS_FILE, JSON.stringify(data))
    })
  }

  // ---- 年ごとの索引(月カレンダー用) ----
  async loadIndex(year: number | string): Promise<YearIndex> {
    const dir = await getDir(this.root, [String(year)], false)
    const idx = dir && parseJson<YearIndex>(await readText(dir, INDEX_FILE), `${year}/${INDEX_FILE}`)
    return idx ?? { version: 1, days: {}, updatedAt: '' }
  }

  private async updateIndex(date: string, d: DayData) {
    const idx = await this.loadIndex(yearOf(date))
    const s = summarize(d)
    if (s) idx.days[date] = s
    else delete idx.days[date]
    idx.updatedAt = new Date().toISOString()
    const dir = (await getDir(this.root, [yearOf(date)], true))!
    await writeBlob(dir, INDEX_FILE, JSON.stringify(idx, null, 2))
  }

  /** 日記.json から索引を作り直す(索引が壊れた・手でフォルダを動かしたとき用) */
  rebuildIndexes(onProgress?: (msg: string) => void): Promise<number> {
    return this.serial(() => this.rebuildIndexesNow(onProgress))
  }

  private async rebuildIndexesNow(onProgress?: (msg: string) => void): Promise<number> {
    let days = 0
    for (const y of await listEntries(this.root)) {
      if (y.kind !== 'directory' || !/^\d{4}$/.test(y.name)) continue
      const idx: YearIndex = { version: 1, days: {}, updatedAt: new Date().toISOString() }
      const ydir = y.handle as FileSystemDirectoryHandle
      for (const d of await listEntries(ydir)) {
        if (d.kind !== 'directory' || !/^\d{4}-\d{2}-\d{2}$/.test(d.name)) continue
        onProgress?.(d.name)
        const s = summarize(await this.loadDay(d.name))
        if (s) {
          idx.days[d.name] = s
          days++
        }
      }
      await writeBlob(ydir, INDEX_FILE, JSON.stringify(idx, null, 2))
    }
    return days
  }

  // ---- 写真ファイル ----
  async photoFile(date: string, file: string, kind: PhotoKind): Promise<File | undefined> {
    const sub = kind === 'thumb' ? [THUMB_DIR] : kind === 'reduced' ? [REDUCED_DIR] : []
    const dir = await getDir(this.root, [yearOf(date), date, ...sub], false)
    return dir && getFile(dir, kind === 'original' ? file : derivedName(file))
  }

  /** 画面に出すための URL。サムネイルは覚えておき、縮小版・原本は使い終わったら release する */
  async photoUrl(date: string, file: string, kind: PhotoKind): Promise<string | undefined> {
    const key = `${kind}/${date}/${file}`
    const cached = this.urls.get(key)
    if (cached) return cached
    let f = await this.photoFile(date, file, kind)
    // サムネイル・縮小版が無いとき(作成に失敗した等)は原本で代用
    if (!f && kind !== 'original') f = await this.photoFile(date, file, 'original')
    if (!f) return undefined
    const url = URL.createObjectURL(f)
    if (kind === 'thumb') this.urls.set(key, url)
    return url
  }

  /**
   * 写真を完全に削除する(原本・縮小版・サムネイルのファイルを消し、日記.json から外す)。元に戻せない。
   * 先にファイルを消してから記録を外す(途中で失敗しても、見えないまま画像だけ残ることが無いように)
   */
  deletePhoto(date: string, file: string): Promise<DayData> {
    return this.serial(async () => {
      const dir = await this.dayDir(date, false)
      if (dir) {
        const removeIn = async (parts: string[], name: string) => {
          const d = await getDir(dir, parts, false)
          if (!d) return
          try {
            await d.removeEntry(name)
          } catch (e) {
            if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e
          }
        }
        await removeIn([], file)
        await removeIn([REDUCED_DIR], derivedName(file))
        await removeIn([THUMB_DIR], derivedName(file))
      }
      this.forgetThumbs(date)
      return this.updateDayNow(date, (d) => {
        const before = d.photos.length
        d.photos = d.photos.filter((p) => p.file !== file)
        if (d.photos.length === before) return false
      }, { before: true })
    })
  }

  /** 登録されている写真の枚数と日数(年ごとの索引から数える) */
  async countAll(): Promise<{ photos: number; days: number }> {
    let photos = 0
    let days = 0
    for (const y of await listEntries(this.root)) {
      if (y.kind !== 'directory' || !/^\d{4}$/.test(y.name)) continue
      for (const s of Object.values((await this.loadIndex(y.name)).days)) {
        photos += s.count
        if (s.count) days++
      }
    }
    return { photos, days }
  }

  /**
   * 写真をすべて完全に削除する(写真の整理し直し用)。
   * 消すのは、日記.json に登録されている写真の原本・縮小版・サムネイルだけ。
   * 保存フォルダにあるほかのフォルダ・ファイル(このアプリが作っていないもの)には触らない。
   * メモは消さない
   */
  deleteAllPhotos(onProgress: (msg: string, deleted: number) => void): Promise<number> {
    return this.serial(async () => {
      let deleted = 0
      const removeQuiet = async (dir: FileSystemDirectoryHandle, name: string) => {
        try {
          await dir.removeEntry(name)
        } catch (e) {
          // 無いもの・中身が残っているフォルダはそのまま
          if (!(e instanceof DOMException && ['NotFoundError', 'InvalidModificationError'].includes(e.name))) throw e
        }
      }
      for (const y of await listEntries(this.root)) {
        if (y.kind !== 'directory' || !/^\d{4}$/.test(y.name)) continue
        const ydir = y.handle as FileSystemDirectoryHandle
        for (const d of await listEntries(ydir)) {
          if (d.kind !== 'directory' || !/^\d{4}-\d{2}-\d{2}$/.test(d.name)) continue
          const ddir = d.handle as FileSystemDirectoryHandle
          if (!(await getFile(ddir, DAY_FILE))) continue // このアプリの日付フォルダではない
          const day = await this.loadDay(d.name)
          const reduced = await getDir(ddir, [REDUCED_DIR], false)
          const thumbs = await getDir(ddir, [THUMB_DIR], false)
          for (const p of day.photos) {
            await removeQuiet(ddir, p.file)
            if (reduced) await removeQuiet(reduced, derivedName(p.file))
            if (thumbs) await removeQuiet(thumbs, derivedName(p.file))
            deleted++
            onProgress(d.name, deleted)
          }
          this.forgetThumbs(d.name)
          // メモは絶対に消さない(メモの無い日だけ日記.json を片付ける)。写真の説明はメモの履歴に控える
          if (day.photos.length) await this.updateDayNow(d.name, (x) => void (x.photos = []), { before: true })
          if (!day.memo.trim()) await removeQuiet(ddir, DAY_FILE)
          // 空になったフォルダだけ片付ける
          await removeQuiet(ddir, REDUCED_DIR)
          await removeQuiet(ddir, THUMB_DIR)
          await removeQuiet(ydir, d.name)
        }
      }
      await this.rebuildIndexesNow()
      return deleted
    })
  }

  /** 別の PC で写真が差し替えられた場合に備え、サムネイルの URL を捨てる */
  forgetThumbs(date: string) {
    for (const [k, u] of this.urls) {
      if (k.startsWith(`thumb/${date}/`)) {
        URL.revokeObjectURL(u)
        this.urls.delete(k)
      }
    }
  }
}

/** メモを保存。読み込んだ後にほかの PC でメモが変わっていたら ConflictError */
export async function saveMemo(lib: Library, date: string, baseMemo: string, myMemo: string, history: HistoryMode = {}): Promise<DayData> {
  return lib.updateDay(
    date,
    (d) => {
      if (d.memo === myMemo) return false
      if (d.memo !== baseMemo) throw new ConflictError(d)
      d.memo = myMemo
    },
    history,
  )
}
