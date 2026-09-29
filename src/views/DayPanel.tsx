import { useCallback, useEffect, useRef, useState } from 'react'
import { jpDate, parseYmd } from '../lib/dates'
import { holidayName } from '../lib/holidays'
import { isLinked, timeLabel, type DayEvent } from '../lib/events'
import { ConflictError, saveMemo, type Library } from '../storage/library'
import { emptyDay, type DayData } from '../storage/model'
import Thumb from './Thumb'

interface Props {
  lib: Library
  date: string
  dayEvents: DayEvent[]
  rev: number // 取り込み・写真画面での保存・画面に戻ったときに増える(読み直しの合図)
  onSaved: () => void
  onOpenPhoto: (day: DayData, file: string, filterKey?: string) => void
}

type SaveState = '' | 'editing' | 'saving' | 'saved' | 'error'

export default function DayPanel({ lib, date, dayEvents, rev, onSaved, onOpenPhoto }: Props) {
  const [day, setDay] = useState<DayData>(emptyDay(date))
  const [loadError, setLoadError] = useState('')
  const [memo, setMemo] = useState('')
  const [save, setSave] = useState<SaveState>('')
  const [saveError, setSaveError] = useState('')
  const [conflict, setConflict] = useState<DayData | null>(null)
  const [filterKey, setFilterKey] = useState<string>()

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
        </h3>
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
        </h3>
        {shown.length === 0 ? (
          <p className="muted small-text">
            {filterEvent ? 'この予定に紐づく写真はありません(写真を開くと手動で紐づけできます)' : '写真はありません'}
          </p>
        ) : (
          <div className="photo-grid">
            {shown.map((p) => (
              <button key={p.file} type="button" className="photo-tile" onClick={() => onOpenPhoto(day, p.file, filterKey)} title={p.caption || p.file}>
                <Thumb lib={lib} date={date} file={p.file} alt={p.caption} />
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
      return '保存しました'
    case 'error':
      return '未保存'
    default:
      return ''
  }
}
