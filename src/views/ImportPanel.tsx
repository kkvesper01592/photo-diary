import { useEffect, useRef, useState } from 'react'
import { DUP_DIR, importFiles, scanInbox, type ImportResult, type InboxScan } from '../storage/importer'
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
  const [scanning, setScanning] = useState(false)
  const [step, setStep] = useState('')
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const [results, setResults] = useState<ImportResult[] | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [stopped, setStopped] = useState(false)
  const finished = !!results && !running
  const stop = useRef(false)

  const rescan = () => {
    setError('')
    setScanning(true)
    scanInbox(lib)
      .then(setScan)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setScanning(false))
  }
  useEffect(rescan, [lib])

  const start = async () => {
    if (!scan?.files.length) return
    stop.current = false
    setRunning(true)
    setDone(0)
    setResults(null)
    setStep('')
    const t0 = Date.now()
    setStartedAt(t0)
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    const rs = await importFiles(
      lib,
      settings,
      scan.files,
      (n) => setDone(n),
      (name, msg) => setStep(`${name}: ${msg}…`),
      () => stop.current,
    ).finally(() => window.clearInterval(tick))
    setElapsed(Date.now() - t0)
    setStopped(stop.current && rs.length < scan.files.length)
    setResults(rs)
    setRunning(false)
    onImported([...new Set(rs.flatMap((r) => (r.status === 'imported' ? [r.date] : [])))])
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

        {!finished && (
        <p className="small-text">
          保存フォルダ「{lib.rootName}」の中の <code>{INBOX}</code> フォルダに写真を入れてから、「取り込む」を押してください。
          撮影日ごとのフォルダに原本を保存し、縮小版(長辺 {settings.reducedLongEdge}px)とサムネイルを作ります。
          {settings.removeFromInbox ? '取り込めた写真は、内容を確認してから取り込み用フォルダから消します。' : '取り込み用フォルダの写真はそのまま残します。'}
          {settings.skipDuplicates ? '' : '(重複の確認はオフです。すべての写真を取り込みます)'}
        </p>
        )}

        {error && <p className="error">{error}</p>}

        {scanning && !scan && <p className="muted">取り込み用フォルダを確認しています…(NAS の場合は少し時間がかかります)</p>}
        {scan && !finished && (
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
              {done} / {scan?.files.length} 枚{remaining(done, scan?.files.length ?? 0, startedAt, now)}
            </span>
            <p className="small-text muted step-line">{step || '準備中…'}</p>
            <button className="small ghost" onClick={() => (stop.current = true)}>
              中止(今の1枚が終わったら止めます)
            </button>
          </div>
        )}

        {finished && (
          <div className={`done-box ${errors.length ? 'has-error' : ''}`} role="status">
            <p className="done-title">
              {stopped ? '⏸ 取り込みを中止しました' : errors.length ? '⚠ 取り込みが終わりました(一部失敗あり)' : '✅ 取り込みが終わりました'}
            </p>
            <p className="small-text">
              {imported.length} 枚を取り込みました(かかった時間: {fmtElapsed(elapsed)})
              {stopped && '。残りの写真は取り込み用フォルダにそのまま残っています'}
            </p>
          </div>
        )}

        {finished && (
          <div className="import-result">
            <h3>結果</h3>
            <table className="result-table">
              <tbody>
                <tr>
                  <th>取り込んだ写真</th>
                  <td>{imported.length} 枚</td>
                </tr>
                <tr>
                  <th>取り込み済み(同じ名前・同じ中身)のため飛ばした写真</th>
                  <td>{dups.length} 枚</td>
                </tr>
                <tr className={errors.length ? 'error' : ''}>
                  <th>失敗した写真</th>
                  <td>{errors.length} 枚</td>
                </tr>
              </tbody>
            </table>
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
            {dups.some((r) => r.status === 'duplicate' && r.moved) && (
              <p className="small-text muted">
                同じ名前・同じ中身の写真が取り込み済みだった写真は、取り込み用フォルダの中の「{DUP_DIR}」フォルダへ移しました(確認して不要なら手で消してください):{' '}
                {dups.filter((r) => r.status === 'duplicate' && r.moved).map((r) => r.name).join('、')}
              </p>
            )}
            {dups.some((r) => r.status === 'duplicate' && !r.moved) && (
              <p className="small-text muted">
                同じ名前・同じ中身の写真が取り込み済みだった写真は、取り込み用フォルダにそのまま残しています(不要なら手で消してください):{' '}
                {dups.filter((r) => r.status === 'duplicate' && !r.moved).map((r) => r.name).join('、')}
              </p>
            )}
            {errors.length > 0 && <p className="small-text muted">失敗した写真は取り込み用フォルダに残っています。もう一度「取り込み」を開くと再度取り込めます。</p>}
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
          {finished ? (
            <>
              <span className="muted small-text foot-note">写真を追加で入れたときは、閉じてからもう一度「取り込み」を開いてください</span>
              <button onClick={onClose}>閉じる</button>
            </>
          ) : (
            <button onClick={() => void start()} disabled={running || scanning || !scan?.files.length}>
              {running ? '取り込み中…' : scanning ? '確認中…' : '取り込む'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** 残り時間の目安(2枚目以降) */
function remaining(done: number, total: number, startedAt: number, now: number): string {
  if (done < 1 || now <= startedAt) return ''
  const sec = Math.round((((now - startedAt) / done) * (total - done)) / 1000)
  if (sec <= 0) return ''
  return `(残り 約${sec >= 60 ? `${Math.ceil(sec / 60)}分` : `${sec}秒`})`
}

function fmtElapsed(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000))
  return sec >= 60 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${sec}秒`
}
