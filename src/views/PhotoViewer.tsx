import { useEffect, useRef, useState } from 'react'
import { jpDate, parseYmd } from '../lib/dates'
import { isLinked, setLink, timeLabel, type DayEvent } from '../lib/events'
import { mapUrlOf } from '../lib/maps'
import type { HistoryMode, Library } from '../storage/library'
import type { DayData, PhotoEntry } from '../storage/model'

interface Props {
  lib: Library
  day: DayData
  dayEvents: DayEvent[]
  files: string[] // 前後に移動できる写真(日の画面で表示していた順)
  file: string
  onMove: (file: string) => void
  onClose: () => void
  onSaved: (day: DayData) => void
  onDeleted: (day: DayData, nextFile?: string) => void
}

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)

export default function PhotoViewer({ lib, day, dayEvents, files, file, onMove, onClose, onSaved, onDeleted }: Props) {
  const photo = day.photos.find((p) => p.file === file)
  const i = files.indexOf(file)
  const [url, setUrl] = useState<string>()
  const [caption, setCaption] = useState(photo?.caption ?? '')
  const [error, setError] = useState('')
  const [captionState, setCaptionState] = useState<'' | 'editing' | 'saved' | 'recorded'>('')
  const captionTimer = useRef<number>(undefined)
  const captionPending = useRef<{ file: string; text: string } | null>(null) // まだ保存していない説明
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => setCaption(photo?.caption ?? ''), [file, photo?.caption])
  useEffect(() => {
    setConfirmDelete(false)
    setCaptionState('')
  }, [file])

  // 縮小版を表示(使い終わったら URL を解放)
  useEffect(() => {
    let alive = true
    let u: string | undefined
    setUrl(undefined)
    lib
      .photoUrl(day.date, file, 'reduced')
      .then((x) => {
        u = x
        if (alive) setUrl(x)
        else if (x) URL.revokeObjectURL(x)
      })
      .catch((e) => setError(String(e)))
    return () => {
      alive = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [lib, day.date, file])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === 'Escape') {
        if (confirmDelete) setConfirmDelete(false)
        else onClose()
      } else if (confirmDelete) return
      else if (e.key === 'ArrowLeft' && i > 0) onMove(files[i - 1])
      else if (e.key === 'ArrowRight' && i < files.length - 1) onMove(files[i + 1])
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [i, files, onClose, onMove, confirmDelete])

  if (!photo) return null

  const update = async (change: (p: PhotoEntry) => void, history: HistoryMode = {}, target = file): Promise<boolean> => {
    setError('')
    try {
      const d = await lib.updateDay(
        day.date,
        (latest) => {
          const p = latest.photos.find((x) => x.file === target)
          if (!p) throw new Error('この写真は、ほかの PC で変更されたため見つかりません')
          change(p)
        },
        history,
      )
      onSaved(d)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }

  // 説明の自動保存(手を止めて約1.5秒後・欄から離れたとき)。履歴には残さない
  const saveCaption = async () => {
    window.clearTimeout(captionTimer.current)
    captionPending.current = null
    if (caption === photo.caption) return true
    const ok = await update((p) => void (p.caption = caption))
    if (ok) setCaptionState('saved')
    return ok
  }

  const onCaptionChange = (v: string) => {
    setCaption(v)
    setCaptionState('editing')
    window.clearTimeout(captionTimer.current)
    captionPending.current = { file, text: v }
    captionTimer.current = window.setTimeout(flushCaption, 1500)
  }

  const flushCaption = () => {
    window.clearTimeout(captionTimer.current)
    const p = captionPending.current
    if (!p) return
    captionPending.current = null
    void update((x) => void (x.caption = p.text), {}, p.file).then((ok) => ok && setCaptionState('saved'))
  }
  const flushRef = useRef(flushCaption)
  flushRef.current = flushCaption

  // 写真を切り替える・閉じるときに、待っている自動保存を済ませる
  useEffect(() => () => flushRef.current(), [file])

  /** 「保存」ボタン: 説明を保存して、履歴に記録する */
  const saveCaptionWithHistory = async () => {
    if (!(await saveCaption())) return
    try {
      await lib.recordHistory(day.date)
      setCaptionState('recorded')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const doDelete = async () => {
    setDeleting(true)
    setError('')
    try {
      const d = await lib.deletePhoto(day.date, file)
      const rest = files.filter((f) => f !== file && d.photos.some((p) => p.file === f))
      const next = rest[Math.min(i, rest.length - 1)]
      setConfirmDelete(false)
      onDeleted(d, next)
    } catch (e) {
      setError(`削除できませんでした: ${e instanceof Error ? e.message : e}`)
    } finally {
      setDeleting(false)
    }
  }

  const openOriginal = async () => {
    const u = await lib.photoUrl(day.date, file, 'original')
    if (!u) return setError('原本のファイルが見つかりません')
    window.open(u, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(u), 60_000)
  }

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="写真">
      <div className="viewer-stage" onClick={onClose}>
        {url ? <img src={url} alt={photo.caption} onClick={(e) => e.stopPropagation()} /> : <p className="muted">読み込み中…</p>}
        {i > 0 && (
          <button className="nav-btn prev" onClick={(e) => (e.stopPropagation(), onMove(files[i - 1]))} aria-label="前の写真">
            ‹
          </button>
        )}
        {i < files.length - 1 && (
          <button className="nav-btn next" onClick={(e) => (e.stopPropagation(), onMove(files[i + 1]))} aria-label="次の写真">
            ›
          </button>
        )}
      </div>
      <div className="viewer-side">
        <div className="viewer-head">
          <span className="muted small-text">
            {i + 1} / {files.length}
          </span>
          <div className="btns">
            <button className="small ghost" onClick={onClose}>
              ← カレンダーに戻る
            </button>
            <button className="icon" onClick={onClose} aria-label="閉じる">
              ×
            </button>
          </div>
        </div>
        <p className="viewer-date">
          {jpDate(parseYmd(day.date))} {photo.dateSource === 'exif' ? photo.takenAt.slice(11, 16) : <span className="muted">(撮影時刻の記録なし)</span>}
        </p>

        <div className="field">
          <span className="field-head">
            <label htmlFor="caption-input">
              説明 <span className="save-state">{captionLabel(captionState)}</span>
            </label>
            <span className="btns">
              <button className="small" onClick={() => void saveCaptionWithHistory()} title="今の説明を保存して、履歴に記録します">
                保存
              </button>
            {caption && (
              <button
                className="small ghost"
                title="今の説明を消します(これまでの内容は履歴に残ります)"
                onClick={() => {
                  if (!window.confirm('この写真の説明を消しますか？(これまでの内容は、日の画面の「履歴」に残ります)')) return
                  window.clearTimeout(captionTimer.current)
                  captionPending.current = null
                  setCaption('')
                  // 消す前の内容を履歴に残してから消す
                  void update((p) => void (p.caption = ''), { before: true }).then((ok) => ok && setCaptionState('saved'))
                }}
              >
                説明を消す
              </button>
            )}
            </span>
          </span>
          <textarea id="caption-input" value={caption} onChange={(e) => onCaptionChange(e.target.value)} onBlur={() => void saveCaption()} rows={3} placeholder="この写真の説明" />
        </div>

        <div className="field">
          <span>撮影場所</span>
          {photo.gps ? (
            <a className="map-btn" href={mapUrlOf(photo.gps)} target="_blank" rel="noopener noreferrer">
              📍 Google マップで見る
            </a>
          ) : (
            <span className="muted small-text">位置情報は記録されていません</span>
          )}
        </div>

        <div className="field">
          <span>関連する予定</span>
          {dayEvents.length === 0 ? (
            <span className="muted small-text">この日の予定はありません</span>
          ) : (
            <ul className="link-list">
              {dayEvents.map((e) => {
                const on = isLinked(photo, e, dayEvents)
                const manual = photo.linkAdd?.includes(e.key) || photo.linkRemove?.includes(e.key)
                return (
                  <li key={e.key}>
                    <label>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(ev) => {
                          const checked = ev.target.checked // 保存を待つ間に元の値へ戻るので、先に読んでおく
                          void update((p) => setLink(p, e, dayEvents, checked))
                        }}
                      />
                      <span className="bar" style={{ background: e.color }} />
                      <span className="ev-time">{timeLabel(e, day.date)}</span>
                      <span className="ev-title">{e.title}</span>
                      {manual && <span className="muted small-text">(手動)</span>}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {error && <p className="error small-text">{error}</p>}

        <div className="viewer-foot">
          <div className="btns">
            <button className="small ghost" onClick={() => void openOriginal()}>
              原本を開く
            </button>
            <button className="small danger" onClick={() => setConfirmDelete(true)}>
              削除
            </button>
          </div>
          <p className="muted small-text">
            {photo.file}
            <br />
            {photo.width}×{photo.height}・{fmtSize(photo.size)}
            {photo.originalName !== photo.file && (
              <>
                <br />
                取り込み前の名前: {photo.originalName}
              </>
            )}
          </p>
        </div>
      </div>
      {confirmDelete && (
        <div className="modal-back confirm-back" onClick={() => !deleting && setConfirmDelete(false)}>
          <div className="modal confirm" role="alertdialog" aria-modal="true" aria-label="写真の削除" onClick={(e) => e.stopPropagation()}>
            <h2>この写真を完全に削除しますか？</h2>
            <p>
              <strong>{photo.file}</strong>({jpDate(parseYmd(day.date))}
              {photo.dateSource === 'exif' && ` ${photo.takenAt.slice(11, 16)}`})
            </p>
            <p className="error">
              保存フォルダから、原本・縮小版・サムネイルのファイルと、説明・予定との紐づけを削除します。
              <br />
              ごみ箱には入らず、<strong>元に戻すことはできません。</strong>
            </p>
            <div className="modal-foot">
              <button className="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting} autoFocus>
                やめる
              </button>
              <button className="danger" onClick={() => void doDelete()} disabled={deleting}>
                {deleting ? '削除中…' : '完全に削除する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function captionLabel(s: '' | 'editing' | 'saved' | 'recorded') {
  return s === 'editing' ? '入力中…' : s === 'saved' ? '自動保存しました' : s === 'recorded' ? '保存しました(履歴に記録)' : ''
}
