import { useEffect, useRef, useState } from 'react'
import { importFiles, scanInbox, type ImportResult, type InboxScan } from '../storage/importer'
import type { Library } from '../storage/library'
import { INBOX, type Settings } from '../storage/model'

interface Props {
  lib: Library
  settings: Settings
  onClose: () => void
  onImported: (dates: string[]) => void
  onJump: (date: string) => void
}

export default function ImportPanel({ lib, settings, onClose, onImported, onJump }: Props) {
  const [scan, setScan] = useState<InboxScan | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [results, setResults] = useState<ImportResult[] | null>(null)
  const stop = useRef(false)

  const rescan = () => {
    setError('')
    scanInbox(lib)
      .then(setScan)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }
  useEffect(rescan, [lib])

  const start = async () => {
    if (!scan?.files.length) return
    stop.current = false
    setRunning(true)
    setDone(0)
    setResults(null)
    const rs = await importFiles(lib, settings, scan.files, (n) => setDone(n), () => stop.current)
    setResults(rs)
    setRunning(false)
    onImported([...new Set(rs.flatMap((r) => (r.status === 'imported' ? [r.date] : [])))])
    rescan()
  }

  const imported = results?.filter((r) => r.status === 'imported') ?? []
  const dups = results?.filter((r) => r.status === 'duplicate') ?? []
  const errors = results?.filter((r) => r.status === 'error') ?? []
  const noDate = imported.filter((r) => r.status === 'imported' && r.noDate)
  const dates = [...new Set(imported.map((r) => (r.status === 'imported' ? r.date : '')))].sort()

  return (
    <div className="modal-back" onClick={() => !running && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="写真の取り込み" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>写真の取り込み</h2>
          {!running && (
            <button className="icon" onClick={onClose} aria-label="閉じる">
              ×
            </button>
          )}
        </div>

        <p className="small-text">
          保存フォルダ「{lib.rootName}」の中の <code>{INBOX}</code> フォルダに写真を入れてから、「取り込む」を押してください。
          撮影日ごとのフォルダに原本を保存し、縮小版(長辺 {settings.reducedLongEdge}px)とサムネイルを作ります。
          {settings.removeFromInbox ? '取り込めた写真は、内容を確認してから取り込み用フォルダから消します。' : '取り込み用フォルダの写真はそのまま残します。'}
        </p>

        {error && <p className="error">{error}</p>}

        {scan && (
          <div className="import-status">
            <p>
              取り込み用フォルダの写真: <strong>{scan.files.length}</strong> 枚
              {!running && (
                <button className="link small-text" onClick={rescan}>
                  再確認
                </button>
              )}
            </p>
            {scan.unsupported.length > 0 && (
              <p className="warn small-text">
                取り込めない種類のファイルが {scan.unsupported.length} 件あります(動画・HEIC など): {scan.unsupported.slice(0, 5).join('、')}
                {scan.unsupported.length > 5 && ' …'}
              </p>
            )}
          </div>
        )}

        {running && (
          <div className="progress-wrap">
            <progress max={scan?.files.length ?? 1} value={done} />
            <span className="small-text">
              {done} / {scan?.files.length} 枚
            </span>
            <button className="small ghost" onClick={() => (stop.current = true)}>
              中止(今の1枚が終わったら止めます)
            </button>
          </div>
        )}

        {results && (
          <div className="import-result">
            <p>
              取り込み: <strong>{imported.length}</strong> 枚 / 取り込み済みのため飛ばした写真: {dups.length} 枚 / 失敗: {errors.length} 枚
            </p>
            {dates.length > 0 && (
              <p className="small-text">
                取り込んだ日:{' '}
                {dates.map((d) => (
                  <button key={d} className="link" onClick={() => onJump(d)}>
                    {d}
                  </button>
                ))}
              </p>
            )}
            {noDate.length > 0 && (
              <p className="warn small-text">
                撮影日時の記録が無い写真が {noDate.length} 枚あり、ファイルの日時の日付に入れました: {noDate.map((r) => r.name).join('、')}
              </p>
            )}
            {dups.length > 0 && (
              <p className="small-text muted">
                取り込み済みと同じ写真は、取り込み用フォルダにそのまま残しています(不要なら手で消してください): {dups.map((r) => r.name).join('、')}
              </p>
            )}
            {errors.length > 0 && (
              <ul className="error small-text">
                {errors.map((r) => (
                  <li key={r.name}>
                    {r.name}: {r.status === 'error' && r.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="modal-foot">
          <button onClick={() => void start()} disabled={running || !scan?.files.length}>
            {running ? '取り込み中…' : '取り込む'}
          </button>
        </div>
      </div>
    </div>
  )
}
