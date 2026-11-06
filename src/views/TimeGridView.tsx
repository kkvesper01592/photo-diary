import { useEffect, useRef } from 'react'
import { WEEKDAYS, addDays, hhmm, sameDay, ymd } from '../lib/dates'
import { holidayName } from '../lib/holidays'
import type { DayEvent } from '../lib/events'
import type { Library } from '../storage/library'
import type { DayData, DaySummary, PhotoEntry } from '../storage/model'
import Thumb from './Thumb'

interface Props {
  lib: Library
  dates: Date[] // 週表示なら7日、1日表示なら1日
  byDay: Map<string, DayEvent[]>
  days: Record<string, DaySummary>
  dayData: Record<string, DayData> // 写真のある日の中身(撮影時刻で並べるため)
  selected: string
  onSelect: (date: string) => void
  onPickDay?: (date: string) => void // 週表示で日付の見出しを押したとき(1日表示へ)
  onOpenPhoto: (day: DayData, file: string) => void
}

const HOUR_PX = 48
const SLOT_MIN = 30 // 写真をまとめる時間の幅(分)
const SLOT_PX = (HOUR_PX * SLOT_MIN) / 60
const HOURS = Array.from({ length: 24 }, (_, i) => i)

interface Placed {
  ev: DayEvent
  top: number
  height: number
  col: number
  cols: number
  label: string
}

// その日の中での位置を計算し、重なる予定は横に並べる
function layoutDay(day: Date, items: DayEvent[]): Placed[] {
  const dayStart = day.getTime()
  const dayEnd = addDays(day, 1).getTime()
  const segs = items
    .filter((ev) => !ev.allDay)
    .map((ev) => {
      const s = Math.max(ev.start.getTime(), dayStart)
      const e = Math.min(Math.max(ev.end.getTime(), ev.start.getTime() + 15 * 60000), dayEnd)
      return { ev, s, e, label: `${sameDay(ev.start, day) ? hhmm(ev.start) : '前日から'} – ${sameDay(ev.end, day) ? hhmm(ev.end) : '翌日'}` }
    })
    .sort((a, b) => a.s - b.s || b.e - a.e)

  const placed: Placed[] = []
  let group: ((typeof segs)[number] & { col: number })[] = []
  let groupEnd = 0
  const flush = () => {
    const cols = Math.max(...group.map((g) => g.col)) + 1
    for (const g of group) {
      placed.push({
        ev: g.ev,
        top: ((g.s - dayStart) / 3600000) * HOUR_PX,
        height: Math.max(((g.e - g.s) / 3600000) * HOUR_PX, 18),
        col: g.col,
        cols,
        label: g.label,
      })
    }
    group = []
  }
  for (const seg of segs) {
    if (group.length && seg.s >= groupEnd) flush()
    const colEnds: number[] = []
    for (const g of group) colEnds[g.col] = Math.max(colEnds[g.col] ?? 0, g.e)
    let col = colEnds.findIndex((end) => end <= seg.s)
    if (col < 0) col = colEnds.length
    group.push({ ...seg, col })
    groupEnd = Math.max(groupEnd, seg.e)
  }
  if (group.length) flush()
  return placed
}

/** 写真を撮影時刻の30分ごとにまとめる */
function photoSlots(day: DayData | undefined): [number, PhotoEntry[]][] {
  const map = new Map<number, PhotoEntry[]>()
  for (const p of day?.photos ?? []) {
    const m = /T(\d\d):(\d\d)/.exec(p.takenAt)
    if (!m) continue
    const slot = Math.floor((Number(m[1]) * 60 + Number(m[2])) / SLOT_MIN)
    const list = map.get(slot)
    if (list) list.push(p)
    else map.set(slot, [p])
  }
  for (const list of map.values()) list.sort((a, b) => a.takenAt.localeCompare(b.takenAt))
  return [...map.entries()].sort((a, b) => a[0] - b[0])
}

/** 週表示・1日表示(時間軸つき)。予定は左、写真は撮影時刻の位置に右側へ並べる */
export default function TimeGridView({ lib, dates, byDay, days, dayData, selected, onSelect, onPickDay, onOpenPhoto }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const today = new Date()
  const single = dates.length === 1
  const cols = { gridTemplateColumns: `52px repeat(${dates.length}, minmax(0, 1fr))` }
  const maxThumbs = single ? 8 : 1

  // 最初は朝8時あたりを表示
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = HOUR_PX * 8
  }, [single])

  const nowTop = ((today.getHours() * 60 + today.getMinutes()) / 60) * HOUR_PX

  return (
    <div className={`timegrid ${single ? 'single-day' : ''}`}>
      <div className="tg-body" ref={scroller}>
        <div className="tg-sticky">
          <div className="tg-head" style={cols}>
            <div />
            {dates.map((d) => {
              const key = ymd(d)
              const hol = holidayName(d.getFullYear(), d.getMonth() + 1, d.getDate())
              const s = days[key]
              const cls = [
                'tg-day',
                hol || d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : '',
                sameDay(d, today) && 'today',
                !single && key === selected && 'selected',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  key={key}
                  type="button"
                  className={cls}
                  onClick={() => (onPickDay ? onPickDay(key) : onSelect(key))}
                  title={onPickDay ? 'この日を1日表示で開く' : undefined}
                >
                  <span className="tg-wd">{WEEKDAYS[d.getDay()]}</span>
                  <span className="daynum">{d.getDate()}</span>
                  <span className="badges">
                    {s?.memo && <span title="メモあり">📝</span>}
                    {!!s?.count && <span className="count">📷{s.count}</span>}
                  </span>
                  {hol && <span className="holiday">{hol}</span>}
                </button>
              )
            })}
          </div>

          <div className="tg-allday" style={cols}>
            <div className="tg-label">終日</div>
            {dates.map((d) => (
              <div key={ymd(d)} className="tg-allday-cell" onClick={() => onSelect(ymd(d))}>
                {(byDay.get(ymd(d)) ?? [])
                  .filter((e) => e.allDay)
                  .map((e) => (
                    <div key={e.key} className="chip" style={{ borderLeftColor: e.color }} title={e.title}>
                      {e.title}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </div>

        <div className="tg-inner" style={{ ...cols, height: HOUR_PX * 24 }}>
          <div className="tg-hours">
            {HOURS.map((h) => (
              <div key={h} className="tg-hour" style={{ top: h * HOUR_PX }}>
                {h === 0 ? '' : `${h}:00`}
              </div>
            ))}
          </div>
          {dates.map((d) => {
            const key = ymd(d)
            const data = dayData[key]
            return (
              <div key={key} className={`tg-col ${!single && key === selected ? 'selected' : ''}`} onClick={() => onSelect(key)}>
                {HOURS.map((h) => (
                  <div key={h} className="tg-line" style={{ top: h * HOUR_PX }} />
                ))}
                {sameDay(d, today) && <div className="tg-now" style={{ top: nowTop }} />}
                <div className="tg-events">
                  {layoutDay(d, byDay.get(key) ?? []).map((p) => (
                    <div
                      key={p.ev.key}
                      className="tg-event"
                      style={{
                        top: p.top,
                        height: p.height,
                        left: `calc(${(p.col / p.cols) * 100}% + 1px)`,
                        width: `calc(${100 / p.cols}% - 3px)`,
                        borderLeftColor: p.ev.color,
                      }}
                      title={`${p.label}\n${p.ev.title}${p.ev.location ? `\n${p.ev.location}` : ''}`}
                    >
                      <span className="tg-ev-title">{p.ev.title}</span>
                      {p.height >= 30 && <span className="tg-ev-time">{p.label}</span>}
                    </div>
                  ))}
                </div>
                <div className="tg-photos">
                  {photoSlots(data).map(([slot, list]) => (
                    <div key={slot} className="tg-slot" style={{ top: slot * SLOT_PX }}>
                      {list.slice(0, maxThumbs).map((p) => (
                        <button
                          key={p.file}
                          type="button"
                          className="tg-thumb"
                          title={`${p.takenAt.slice(11, 16)} ${p.caption || p.originalName}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelect(key)
                            onOpenPhoto(data!, p.file)
                          }}
                        >
                          <Thumb lib={lib} date={key} file={p.file} />
                        </button>
                      ))}
                      {list.length > maxThumbs && <span className="tg-more">+{list.length - maxThumbs}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
