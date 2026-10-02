import { useCallback, useEffect, useRef, useState } from 'react'
import { jpDate, parseYmd } from '../lib/dates'
import { holidayName } from '../lib/holidays'
import { isLinked, timeLabel, type DayEvent } from '../lib/events'
import { ConflictError, saveMemo, type Library } from '../storage/library'
import { emptyDay, type DayData, type MemoHistory } from '../storage/model'
import Thumb from './Thumb'

interface Props {
  lib: Library
  date: string
  dayEvents: DayEvent[]
  rev: number // 取り込み・写真画面での保存・画面に戻ったときに増える(読み直しの合図)
  onSaved: () => void
  onOpenPhoto: (day: DayData, file: string, filterKey?: string) => void
}

type SaveState = '' | 'editing' | 'saving' | 'saved' | 'recorded' | 'error'

export default function DayPanel({ lib, date, dayEvents, rev, onSaved, onOpenPhoto }: Props) {
  const [day, setDay] = useState<DayData>(emptyDay(date))
  const [loadError, setLoadError] = useState('')
  const [memo, setMemo] = useState('')
  const [save, setSave] = useState<SaveState>('')
  const [saveError, setSaveError] = useState('')
  const [conflict, setConflict] = useState<DayData | null>(null)
  const [filterKey, setFilterKey] = useState<string>()
  // 選んで削除
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirmDel, setConfirmDel] = useState(false)
  const [delProgress, setDelProgress] = useState<{ done: number; total: number } | null>(null)
  const [delError, setDelError] = useState('')
  const [history, setHistory] = useState<MemoHistory | null>(null)
  const [historyError, setHistoryError] = useState('')

  // 保存待ちのメモ(日付を切り替えたときにも保存するため ref で持つ)
  const pending = useRef<{ date: string; base: string; memo: string } | null>(null)
  const timer = useRef<number>(undefined)
  const shownDate = useRef(date)
  shownDate.current = date
  const inConflict = useRef(false) // 競合の選択を待つ間は、自動保存しない

  const flush = useCallback(async (force = false) => {
    window.clearTimeout(timer.current)
    const p = pending.current
    if (!p || (inConflict.current && !force)) return
    pending.current = null
    if (p.date === shownDate.current) setSave('saving')
    try {
      const d = await saveMemo(lib, p.date, p.base, p.memo)
      if (p.date === shownDate.current) {
        setDay(d)
        setSave('saved')
        setSaveError('')
      }
      onSaved()
    } catch (e) {
      // 保存できなかった内容は残しておく(画面に表示中の日なら、選択肢・再試行を出す)
      pending.current ??= p
      if (p.date !== shownDate.current) {
        window.alert(`${p.date} のメモを保存できませんでした。もう一度その日を開いてください。\n${e instanceof Error ? e.message : e}`)
        return
      }
      setSave('error')
      if (e instanceof ConflictError) {
        inConflict.current = true
        setConflict(e.latest)
      } else setSaveError(e instanceof Error ? e.message : String(e))
    }
  }, [lib, onSaved])

  // 読み込み(日付の切り替え・rev の変化)。入力中のメモがあるときは読み直さない
  useEffect(() => {
    let alive = true
    if (pending.current?.date === date) return
    lib
      .loadDay(date)
      .then((d) => {
        if (!alive || pending.current?.date === date) return
        setDay(d)
        setMemo(d.memo)
        setLoadError('')
      })
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)))
    return () => void (alive = false)
  }, [lib, date, rev])

  // 日付を切り替えたら表示をリセットし、切り替え前の日のメモを保存する
  useEffect(() => {
    setFilterKey(undefined)
    setSelecting(false)
    setPicked(new Set())
    setConfirmDel(false)
    setDelError('')
    setSave('')
    setSaveError('')
    setConflict(null)
    inConflict.current = false
    return () => void flush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  // タブを閉じる前に未保存のメモがあれば確認
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (pending.current) {
        void flush()
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [flush])

  const onMemoChange = (v: string) => {
    setMemo(v)
    pending.current = { date, base: pending.current?.base ?? day.memo, memo: v }
    setSave('editing')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), 1500)
  }

  /** 「保存」ボタン: 入力中の内容を保存し、履歴に記録する */
  const saveWithHistory = async () => {
    await flush()
    if (pending.current) return // 保存できなかった(競合など)
    try {
      await lib.recordHistory(date)
      setSave('recorded')
    } catch (e) {
      setSave('error')
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }

  /** 履歴から戻す(戻す前の内容・戻した内容の両方を履歴に残す) */
  const restoreMemo = async (text: string) => {
    await flush()
    if (pending.current) return
    try {
      const d = await lib.updateDay(date, (x) => (x.memo === text ? false : void (x.memo = text)), { before: true, after: true })
      setDay(d)
      setMemo(d.memo)
      setSave('recorded')
      onSaved()
    } catch (e) {
      setSave('error')
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }

  const resolveConflict = async (how: 'mine' | 'theirs' | 'both') => {
    const p = pending.current
    const latest = conflict
    if (!p || !latest) return
    setConflict(null)
    inConflict.current = false
    if (how === 'theirs') {
      pending.current = null
      setDay(latest)
      setMemo(latest.memo)
      setSave('')
      return
    }
    const merged = how === 'mine' ? p.memo : `${latest.memo}\n\n---(この PC で書いた内容)---\n${p.memo}`
    pending.current = { date: p.date, base: latest.memo, memo: merged }
    setMemo(merged)
    await flush(true)
  }

  const d = parseYmd(date)
  const hol = holidayName(d.getFullYear(), d.getMonth() + 1, d.getDate())
  const filterEvent = dayEvents.find((e) => e.key === filterKey)
  const shown = filterEvent ? day.photos.filter((p) => isLinked(p, filterEvent, dayEvents)) : day.photos
  const pickedList = day.photos.filter((p) => picked.has(p.file))

  const togglePick = (file: string) =>
    setPicked((cur) => {
      const next = new Set(cur)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })

  const endSelecting = () => {
    setSelecting(false)
    setPicked(new Set())
    setConfirmDel(false)
  }

  const deletePicked = async () => {
    const files = pickedList.map((p) => p.file)
    setDelError('')
    setDelProgress({ done: 0, total: files.length })
    const failed: string[] = []
    let latest = day
    for (const [n, f] of files.entries()) {
      try {
        latest = await lib.deletePhoto(date, f)
      } catch (e) {
        failed.push(`${f}(${e instanceof Error ? e.message : e})`)
      }
      setDelProgress({ done: n + 1, total: files.length })
    }
    setDay(latest)
    setDelProgress(null)
    setConfirmDel(false)
    setPicked(new Set(failed.length ? files.filter((f) => latest.photos.some((p) => p.file === f)) : []))
    if (failed.length) setDelError(`削除できなかった写真があります: ${failed.join('、')}`)
    else setSelecting(false)
    onSaved()
  }

  return (
    <aside className="day-panel">
      <h2>
        {jpDate(d)} {hol && <span className="holiday-tag">{hol}</span>}
      </h2>
      {loadError && <p className="error">{loadError}</p>}

      <section>
        <h3>予定</h3>
        {dayEvents.length === 0 ? (
          <p className="muted small-text">この日の予定はありません</p>
        ) : (
          <ul className="ev-list">
            {dayEvents.map((e) => {
              const n = day.photos.filter((p) => isLinked(p, e, dayEvents)).length
              const on = e.key === filterKey
              return (
                <li key={e.key}>
                  <button
                    type="button"
                    className={`ev-row ${on ? 'on' : ''}`}
                    onClick={() => setFilterKey(on ? undefined : e.key)}
                    title={[e.calendarName, e.location, e.description?.replace(/<[^>]+>/g, '')].filter(Boolean).join('\n')}
                  >
                    <span className="bar" style={{ background: e.color }} />
                    <span className="ev-time">{timeLabel(e, date)}</span>
                    <span className="ev-title">{e.title}</span>
                    <span className={`ev-count ${n ? '' : 'zero'}`}>📷{n}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <h3>
          メモ <span className="save-state">{saveLabel(save)}</span>
          <button className="small push-right" onClick={() => void saveWithHistory()} title="今の内容を保存して、履歴に記録します">
            保存
          </button>
          <button
            className="link small-text"
            onClick={() => {
              setHistoryError('')
              void flush()
                .then(() => lib.loadMemoHistory(date))
                .then(setHistory)
                .catch((e) => setHistoryError(e instanceof Error ? e.message : String(e)))
            }}
            title="これまでに保存したメモ・写真の説明を見て、元に戻せます"
          >
            履歴
          </button>
        </h3>
        {historyError && <p className="error small-text">{historyError}</p>}
        <textarea
          className="memo"
          value={memo}
          onChange={(e) => onMemoChange(e.target.value)}
          onBlur={() => void flush()}
          placeholder="この日の仕事の記録(自動で保存されます)"
          rows={5}
        />
        {save === 'error' && saveError && (
          <p className="error small-text">
            保存できませんでした: {saveError}{' '}
            <button className="small" onClick={() => void flush()}>
              もう一度保存
            </button>
          </p>
        )}
        {conflict && (
          <div className="conflict">
            <p>ほかの PC で、この日のメモが先に変更されていました。どうしますか？</p>
            <pre className="conflict-text">{conflict.memo || '(空)'}</pre>
            <div className="btns">
              <button className="small" onClick={() => void resolveConflict('both')}>
                両方を残す(つなげて保存)
              </button>
              <button className="small ghost" onClick={() => void resolveConflict('mine')}>
                この PC の内容で上書き
              </button>
              <button className="small ghost" onClick={() => void resolveConflict('theirs')}>
                ほかの PC の内容にする
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h3>
          写真 {filterEvent ? `「${filterEvent.title}」 ${shown.length} 枚` : `${day.photos.length} 枚`}
          {filterEvent && (
            <button className="link small-text" onClick={() => setFilterKey(undefined)}>
              すべて表示
            </button>
          )}
          {shown.length > 0 && !selecting && (
            <button className="small ghost push-right" onClick={() => setSelecting(true)} title="写真を選んで削除します">
              選んで削除
            </button>
          )}
        </h3>
        {selecting && (
          <div className="select-bar">
            <span className="small-text">
              {picked.size ? `${picked.size} 枚を選択中` : '削除する写真をクリックして選んでください'}
            </span>
            <button className="link small-text" onClick={() => setPicked(new Set(shown.map((p) => p.file)))}>
              表示中をすべて選択
            </button>
            {picked.size > 0 && (
              <button className="link small-text" onClick={() => setPicked(new Set())}>
                選択を解除
              </button>
            )}
            <span className="push-right btns">
              <button className="small ghost" onClick={endSelecting}>
                やめる
              </button>
              <button className="small danger" disabled={!picked.size} onClick={() => setConfirmDel(true)}>
                選んだ {picked.size} 枚を削除
              </button>
            </span>
          </div>
        )}
        {delError && <p className="error small-text">{delError}</p>}
        {shown.length === 0 ? (
          <p className="muted small-text">
            {filterEvent ? 'この予定に紐づく写真はありません(写真を開くと手動で紐づけできます)' : '写真はありません'}
          </p>
        ) : (
          <div className="photo-grid">
            {shown.map((p) => (
              <button
                key={p.file}
                type="button"
                className={`photo-tile ${selecting ? 'selecting' : ''} ${picked.has(p.file) ? 'picked' : ''}`}
                onClick={() => (selecting ? togglePick(p.file) : onOpenPhoto(day, p.file, filterKey))}
                title={p.caption || p.file}
                aria-pressed={selecting ? picked.has(p.file) : undefined}
              >
                <Thumb lib={lib} date={date} file={p.file} alt={p.caption} />
                {selecting && <span className="tile-check">{picked.has(p.file) ? '✓' : ''}</span>}
                <span className="tile-time">
                  {p.dateSource === 'exif' ? p.takenAt.slice(11, 16) : '時刻不明'}
                  {p.gps && ' 📍'}
                </span>
                {p.caption && <span className="tile-caption">{p.caption}</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      {history && (
        <div className="modal-back confirm-back" onClick={() => setHistory(null)}>
          <div className="modal history" role="dialog" aria-modal="true" aria-label="メモの履歴" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{jpDate(d)} のメモの履歴</h2>
              <button className="icon" onClick={() => setHistory(null)} aria-label="閉じる">
                ×
              </button>
            </div>
            <p className="muted small-text">保存のたびに控えています(新しい順)。写真を削除しても、この履歴は消えません。</p>
            {history.versions.length === 0 ? (
              <p className="muted">まだ履歴はありません</p>
            ) : (
              <ul className="history-list">
                {[...history.versions].reverse().map((v, i) => (
                  <li key={`${v.savedAt}-${i}`}>
                    <div className="history-head">
                      <span className="small-text muted">{v.savedAt ? new Date(v.savedAt).toLocaleString('ja-JP') : '(日時不明)'}</span>
                      {v.memo === memo ? (
                        <span className="small-text muted">今のメモと同じ</span>
                      ) : (
                        <button
                          className="small ghost"
                          onClick={() => {
                            if (!window.confirm('今のメモを、この時点の内容に戻しますか？(今の内容も履歴に残ります)')) return
                            setHistory(null)
                            void restoreMemo(v.memo)
                          }}
                        >
                          このメモに戻す
                        </button>
                      )}
                    </div>
                    <pre className="history-memo">{v.memo || '(メモなし)'}</pre>
                    {Object.keys(v.captions).length > 0 && (
                      <ul className="small-text muted history-captions">
                        {Object.entries(v.captions).map(([f, c]) => (
                          <li key={f}>
                            {f}: {c}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="modal-back confirm-back" onClick={() => !delProgress && setConfirmDel(false)}>
          <div className="modal confirm" role="alertdialog" aria-modal="true" aria-label="写真の削除" onClick={(e) => e.stopPropagation()}>
            <h2>選んだ {pickedList.length} 枚の写真を完全に削除しますか？</h2>
            <p className="small-text">{jpDate(d)}</p>
            <ul className="del-list small-text">
              {pickedList.map((p) => (
                <li key={p.file}>
                  {p.file}
                  {p.dateSource === 'exif' && `(${p.takenAt.slice(11, 16)})`}
                  {p.caption && ` 「${p.caption}」`}
                </li>
              ))}
            </ul>
            <p className="error">
              保存フォルダから、原本・縮小版・サムネイルのファイルと、説明・予定との紐づけを削除します。
              <br />
              ごみ箱には入らず、<strong>元に戻すことはできません。</strong>
            </p>
            {delProgress && (
              <p className="small-text">
                削除中… {delProgress.done} / {delProgress.total} 枚
              </p>
            )}
            <div className="modal-foot">
              <button className="ghost" onClick={() => setConfirmDel(false)} disabled={!!delProgress} autoFocus>
                やめる
              </button>
              <button className="danger" onClick={() => void deletePicked()} disabled={!!delProgress}>
                {delProgress ? '削除中…' : `${pickedList.length} 枚を完全に削除する`}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

function saveLabel(s: SaveState) {
  switch (s) {
    case 'editing':
      return '入力中…'
    case 'saving':
      return '保存中…'
    case 'saved':
      return '自動保存しました'
    case 'recorded':
      return '保存しました(履歴に記録)'
    case 'error':
      return '未保存'
    default:
      return ''
  }
}
