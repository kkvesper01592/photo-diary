// IndexedDB: この端末だけの記録(保存フォルダのハンドル、予定のキャッシュ)。
// WebCalendar と同じサイト(github.io)に置いても混ざらないように、別の名前にする
// 専用アプリの中では、IndexedDB の代わりにアプリ本体が暗号化して保存する
import { hostCall, inDesktopApp, reviveHost } from '../desktop/host'
const DB = 'photodiary'
const KV = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(KV)) req.result.createObjectStore(KV)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(KV, mode).objectStore(KV))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  }).finally(() => db.close())
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  if (inDesktopApp) {
    try {
      const json = await hostCall<string | null>('kv.get', { key })
      return json == null ? undefined : (JSON.parse(json, reviveHost) as T)
    } catch {
      return undefined
    }
  }
  try {
    return await tx<T | undefined>('readonly', (s) => s.get(key))
  } catch {
    return undefined
  }
}

export const idbSet = (key: string, value: unknown): Promise<void> =>
  inDesktopApp
    ? hostCall<void>('kv.set', { key, json: JSON.stringify(value) })
    : tx<void>('readwrite', (s) => s.put(value, key)).then(() => undefined)

export const idbDelete = (key: string): Promise<void> =>
  inDesktopApp ? hostCall<void>('kv.delete', { key }) : tx<void>('readwrite', (s) => s.delete(key)).then(() => undefined)
