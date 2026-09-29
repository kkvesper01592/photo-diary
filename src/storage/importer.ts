import { localIso, ymd } from '../lib/dates'
import { getDir, getFile, listEntries, writeBlob } from './fs'
import { makeResized, readMeta, sha256 } from './images'
import type { Library } from './library'
import { INBOX, REDUCED_DIR, THUMB_DIR, THUMB_LONG_EDGE, derivedName, type PhotoEntry, type Settings } from './model'

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i
const UNSUPPORTED_EXT = /\.(heic|heif|dng|raw|mp4|mov|3gp)$/i

export interface InboxFile {
  name: string
  handle: FileSystemFileHandle
}

export interface InboxScan {
  files: InboxFile[]
  unsupported: string[] // 取り込めない種類のファイル(動画・HEIC など)
}

export async function scanInbox(lib: Library): Promise<InboxScan> {
  const inbox = await lib.ensureInbox()
  const files: InboxFile[] = []
  const unsupported: string[] = []
  for (const e of await listEntries(inbox)) {
    if (e.kind !== 'file') continue
    if (IMAGE_EXT.test(e.name)) files.push({ name: e.name, handle: e.handle as FileSystemFileHandle })
    else if (UNSUPPORTED_EXT.test(e.name)) unsupported.push(e.name)
  }
  files.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }))
  return { files, unsupported }
}

export type ImportResult =
  | { name: string; status: 'imported'; date: string; file: string; noDate: boolean }
  | { name: string; status: 'duplicate'; date: string }
  | { name: string; status: 'error'; message: string }

function safeName(name: string) {
  return name.replace(/[\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'photo.jpg'
}

/** 同じ日のフォルダに同名ファイルがあれば _2, _3… を付ける */
async function uniqueName(dir: FileSystemDirectoryHandle, used: Set<string>, name: string): Promise<string> {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 1; ; i++) {
    const cand = i === 1 ? name : `${base}_${i}${ext}`
    if (!used.has(cand.toLowerCase()) && !(await getFile(dir, cand))) return cand
  }
}

/** 1枚取り込む: 原本を日付フォルダへコピー → 読み戻して確認 → 縮小版・サムネイル → 日記.json に追加 → 取り込み用フォルダから消す */
async function importOne(lib: Library, settings: Settings, f: InboxFile): Promise<ImportResult> {
  const file = await f.handle.getFile()
  const hash = await sha256(file)
  const meta = await readMeta(file)
  const taken = meta.takenAt ?? new Date(file.lastModified)
  const date = ymd(taken)

  const day = await lib.loadDay(date)
  if (day.photos.some((p) => p.hash === hash)) return { name: f.name, status: 'duplicate', date }

  const resized = await makeResized(file, settings.reducedLongEdge, THUMB_LONG_EDGE)

  const dir = (await lib.dayDir(date, true))!
  const name = await uniqueName(dir, new Set(day.photos.map((p) => p.file.toLowerCase())), safeName(f.name))
  await writeBlob(dir, name, file)
  // 原本は取り込み用フォルダから消すことがあるので、中身まで一致するか確かめる
  const copied = await getFile(dir, name)
  if (!copied || (await sha256(copied)) !== hash) throw new Error('コピーした原本の内容が一致しません')

  await writeBlob((await getDir(dir, [REDUCED_DIR], true))!, derivedName(name), resized.reduced)
  await writeBlob((await getDir(dir, [THUMB_DIR], true))!, derivedName(name), resized.thumb)

  const entry: PhotoEntry = {
    file: name,
    originalName: f.name,
    takenAt: localIso(taken),
    dateSource: meta.takenAt ? 'exif' : 'file',
    caption: '',
    ...(meta.gps ? { gps: meta.gps } : {}),
    width: resized.width,
    height: resized.height,
    size: file.size,
    hash,
    importedAt: new Date().toISOString(),
  }
  await lib.updateDay(date, (d) => {
    if (d.photos.some((p) => p.hash === hash)) return false
    d.photos.push(entry)
    d.photos.sort((a, b) => a.takenAt.localeCompare(b.takenAt))
  })
  lib.forgetThumbs(date)

  if (settings.removeFromInbox) {
    const inbox = await lib.ensureInbox()
    await inbox.removeEntry(f.name)
  }
  return { name: f.name, status: 'imported', date, file: name, noDate: !meta.takenAt }
}

export async function importFiles(
  lib: Library,
  settings: Settings,
  files: InboxFile[],
  onProgress: (done: number, r: ImportResult) => void,
  shouldStop: () => boolean,
): Promise<ImportResult[]> {
  const results: ImportResult[] = []
  for (const f of files) {
    if (shouldStop()) break
    let r: ImportResult
    try {
      r = await importOne(lib, settings, f)
    } catch (e) {
      r = { name: f.name, status: 'error', message: e instanceof Error ? e.message : String(e) }
    }
    results.push(r)
    onProgress(results.length, r)
  }
  return results
}

export { INBOX }
