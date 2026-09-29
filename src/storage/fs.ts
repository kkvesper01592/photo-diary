// File System Access API(Edge / Chrome)で、選んだ保存フォルダ(NAS など)を直接読み書きする
import { idbGet, idbSet } from '../lib/idb'

type PermState = 'granted' | 'denied' | 'prompt'
interface PermHandle {
  queryPermission(o: { mode: 'readwrite' }): Promise<PermState>
  requestPermission(o: { mode: 'readwrite' }): Promise<PermState>
}
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  }
}

export const canPickFolder = () => typeof window.showDirectoryPicker === 'function'

const ROOT_KEY = 'rootHandle'

export const loadSavedRoot = () => idbGet<FileSystemDirectoryHandle>(ROOT_KEY)
export const saveRoot = (h: FileSystemDirectoryHandle) => idbSet(ROOT_KEY, h)

export const pickRoot = () => window.showDirectoryPicker!({ id: 'photo-diary-root', mode: 'readwrite' })

/** 前回選んだフォルダの利用許可の状態(prompt なら、ボタン操作で許可を求め直す必要がある) */
export async function permissionOf(h: FileSystemDirectoryHandle): Promise<PermState> {
  const p = h as unknown as Partial<PermHandle>
  return p.queryPermission ? p.queryPermission({ mode: 'readwrite' }) : 'granted'
}

export async function requestPermission(h: FileSystemDirectoryHandle): Promise<boolean> {
  const p = h as unknown as Partial<PermHandle>
  return !p.requestPermission || (await p.requestPermission({ mode: 'readwrite' })) === 'granted'
}

const isNotFound = (e: unknown) => e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')

/** パス(フォルダ名の配列)のフォルダ。create=false で無ければ undefined */
export async function getDir(root: FileSystemDirectoryHandle, parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | undefined> {
  let dir = root
  try {
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create })
    return dir
  } catch (e) {
    if (!create && isNotFound(e)) return undefined
    throw e
  }
}

export async function getFile(dir: FileSystemDirectoryHandle, name: string): Promise<File | undefined> {
  try {
    return await (await dir.getFileHandle(name)).getFile()
  } catch (e) {
    if (isNotFound(e)) return undefined
    throw e
  }
}

export async function readText(dir: FileSystemDirectoryHandle, name: string): Promise<string | undefined> {
  return (await getFile(dir, name))?.text()
}

/** 書き込んだ後、サイズを読み戻して確認する。
 * ブラウザは一時ファイルに書いてから置き換えるので、途中で止まっても前の内容は壊れない */
export async function writeBlob(dir: FileSystemDirectoryHandle, name: string, data: Blob | string): Promise<void> {
  const blob = typeof data === 'string' ? new Blob([data], { type: 'application/json' }) : data
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(blob)
  await w.close()
  const size = (await fh.getFile()).size
  if (size !== blob.size) throw new Error(`${name} の保存サイズが一致しません(${size} / ${blob.size})`)
}

export interface Entry {
  name: string
  kind: 'file' | 'directory'
  handle: FileSystemHandle
}

export async function listEntries(dir: FileSystemDirectoryHandle): Promise<Entry[]> {
  const out: Entry[] = []
  for await (const h of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
    out.push({ name: h.name, kind: h.kind, handle: h })
  }
  return out
}
