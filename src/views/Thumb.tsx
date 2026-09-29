import { useEffect, useState } from 'react'
import type { Library } from '../storage/library'

/** サムネイル画像(保存フォルダから読み込む) */
export default function Thumb({ lib, date, file, alt = '', className }: { lib: Library; date: string; file: string; alt?: string; className?: string }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let alive = true
    setUrl(undefined)
    lib
      .photoUrl(date, file, 'thumb')
      .then((u) => alive && setUrl(u))
      .catch(() => {})
    return () => void (alive = false)
  }, [lib, date, file])
  return url ? <img src={url} alt={alt} className={className} loading="lazy" decoding="async" draggable={false} /> : <div className={`${className ?? ''} thumb-empty`} />
}
