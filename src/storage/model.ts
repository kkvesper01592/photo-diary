// 保存フォルダの中身の形。エクスプローラーで見ても分かるように、普通のフォルダと JSON で保存する
//
// <保存フォルダ>/
//   _取り込み/                  ← ここに写真を入れて「取り込み」を押す
//   写真日記_設定.json          ← どの PC から開いても同じ設定
//   2026/
//     _索引.json                ← 月カレンダー表示用の一覧(日記.json から作り直せる)
//     2026-09-29/
//       IMG_0001.jpg            ← 原本(そのまま保存)
//       日記.json               ← その日のメモ・写真ごとの説明・予定との紐づけ
//       縮小版/IMG_0001.jpg
//       サムネイル/IMG_0001.jpg

export const INBOX = '_取り込み'
export const SETTINGS_FILE = '写真日記_設定.json'
export const INDEX_FILE = '_索引.json'
export const DAY_FILE = '日記.json'
export const REDUCED_DIR = '縮小版'
export const THUMB_DIR = 'サムネイル'

export interface Gps {
  lat: number
  lng: number
}

export interface PhotoEntry {
  file: string // 日付フォルダの中のファイル名
  originalName: string // 取り込む前のファイル名
  takenAt: string // 撮影日時 2026-09-29T10:15:00(時差なし・日本時間)
  dateSource: 'exif' | 'file' // 撮影日時の出どころ(file = 写真に記録が無くファイルの日時を使った)
  caption: string
  gps?: Gps
  width: number
  height: number
  size: number
  hash: string // SHA-256(重複の取り込みを防ぐ)
  importedAt: string
  linkAdd?: string[] // 手動で紐づけた予定(eventKey)
  linkRemove?: string[] // 自動の紐づけから外した予定(eventKey)
}

export interface DayData {
  version: 1
  date: string
  memo: string
  photos: PhotoEntry[]
  updatedAt: string
}

export interface DaySummary {
  count: number
  cover?: string // 月カレンダーに出す写真(サムネイルのファイル名)
  memo?: string // メモの先頭(表示・検索用)
}

export interface YearIndex {
  version: 1
  days: Record<string, DaySummary>
  updatedAt: string
}

export interface Settings {
  version: 1
  hiddenCalendarIds: string[] // 表示しないカレンダー(既定は全部表示。新しく作ったカレンダーも表示される)
  reducedLongEdge: number // 縮小版の長辺(px)
  removeFromInbox: boolean // 取り込み後、取り込み用フォルダから元のファイルを消す
  skipDuplicates: boolean // 同じ日・同じファイル名・同じ中身の写真が取り込み済みなら取り込まない
}

export const DEFAULT_SETTINGS: Settings = { version: 1, hiddenCalendarIds: [], reducedLongEdge: 1920, removeFromInbox: true, skipDuplicates: true }

export const THUMB_LONG_EDGE = 480

/** 縮小版・サムネイルのファイル名(JPEG で保存するので、原本が PNG などなら .jpg を足す) */
export const derivedName = (file: string) => (/\.jpe?g$/i.test(file) ? file : `${file}.jpg`)

export const emptyDay = (date: string): DayData => ({ version: 1, date, memo: '', photos: [], updatedAt: '' })

export function summarize(d: DayData): DaySummary | undefined {
  if (!d.photos.length && !d.memo.trim()) return undefined
  const sorted = [...d.photos].sort((a, b) => a.takenAt.localeCompare(b.takenAt))
  return { count: d.photos.length, cover: sorted[0]?.file, memo: d.memo.trim() ? d.memo.trim().slice(0, 200) : undefined }
}
