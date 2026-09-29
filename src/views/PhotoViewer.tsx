import { useEffect, useState } from 'react'
import { jpDate, parseYmd } from '../lib/dates'
import { isLinked, setLink, timeLabel, type DayEvent } from '../lib/events'
import { mapUrlOf } from '../lib/maps'
import type { Library } from '../storage/library'
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
}

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)

export default function PhotoViewer({ lib, day, dayEvents, files, file, onMove, onClose, onSaved }: Props) {
  const photo = day.photos.find((p) => p.file === file)
  const i = files.indexOf(file)
  const [url, setUrl] = useState<string>()
  const [caption, setCaption] = useState(photo?.caption ?? '')
  const [error, setError] = useState('')

  useEffect(() => setCaption(photo?.caption ?? ''), [file, photo?.caption])

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
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && i > 0) onMove(files[i - 1])
      else if (e.key === 'ArrowRight' && i < files.length - 1) onMove(files[i + 1])
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [i, files, onClose, onMove])

  if (!photo) return null

  const update = async (change: (p: PhotoEntry) => void) => {
    setError('')
    try {
      const d = await lib.updateDay(day.date, (latest) => {
        const p = latest.photos.find((x) => x.file === file)
        if (!p) throw new Error('この写真は、ほかの PC で変更されたため見つかりません')
        change(p)
      })
      onSaved(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const saveCaption = () => {
    if (caption !== photo.caption) void update((p) => void (p.caption = caption))
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
          <button className="icon" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <p className="viewer-date">
          {jpDate(parseYmd(day.date))} {photo.dateSource === 'exif' ? photo.takenAt.slice(11, 16) : <span className="muted">(撮影時刻の記録なし)</span>}
        </p>

        <label className="field">
          <span>説明</span>
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={saveCaption} rows={3} placeholder="この写真の説明" />
        </label>

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
          <button className="small ghost" onClick={() => void openOriginal()}>
            原本を開く
          </button>
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
    </div>
  )
}
