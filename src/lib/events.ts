import type { CalendarEvent, CalendarListEntry } from '../google/calendarApi'
import { addDays, hhmm, parseYmd } from './dates'
import type { DayData, PhotoEntry } from '../storage/model'

/** 画面で使う予定の形 */
export interface DayEvent {
  key: string // カレンダーID + 予定ID(写真との紐づけの保存に使う)
  calendarId: string
  calendarName: string
  title: string
  color: string
  allDay: boolean
  start: Date
  end: Date // 排他
  location?: string
  description?: string
}

export const eventKey = (calendarId: string, eventId: string) => `${calendarId}|${eventId}`

export function toDayEvent(cal: CalendarListEntry, ev: CalendarEvent): DayEvent | undefined {
  if (ev.status === 'cancelled' || !ev.start) return undefined
  const allDay = !!ev.start.date
  const start = allDay ? parseYmd(ev.start.date!) : new Date(ev.start.dateTime!)
  const end = allDay ? parseYmd(ev.end?.date ?? ev.start.date!) : new Date(ev.end?.dateTime ?? ev.start.dateTime!)
  return {
    key: eventKey(cal.id, ev.id),
    calendarId: cal.id,
    calendarName: cal.summaryOverride || cal.summary,
    title: ev.summary || '(タイトルなし)',
    color: cal.backgroundColor || '#2f6fdb',
    allDay,
    start,
    end: end > start ? end : allDay ? addDays(start, 1) : start,
    location: ev.location,
    description: ev.description,
  }
}

/** その日にかかる予定(終日 → 時刻の順) */
export function eventsOnDay(events: DayEvent[], date: string): DayEvent[] {
  const s = parseYmd(date)
  const e = addDays(s, 1)
  return events
    .filter((ev) => ev.start < e && (ev.end > s || (ev.end.getTime() === ev.start.getTime() && ev.start >= s)))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime())
}

export function timeLabel(ev: DayEvent, date: string): string {
  if (ev.allDay) return '終日'
  const s = parseYmd(date)
  const e = addDays(s, 1)
  const from = ev.start < s ? '…' : hhmm(ev.start)
  const to = ev.end > e ? '…' : hhmm(ev.end)
  return `${from}〜${to}`
}

const takenDate = (p: PhotoEntry) => new Date(p.takenAt)

/** 時刻のある予定に、撮影時刻が入っているか(前後の余裕は含めない) */
function inTimed(p: PhotoEntry, ev: DayEvent) {
  const t = takenDate(p)
  return !ev.allDay && t >= ev.start && t <= ev.end
}

/**
 * 写真が予定に紐づくか。
 *  - 手動で紐づけ・外したものはそれに従う
 *  - 時刻のある予定: 撮影時刻が予定の時間内
 *  - 終日の予定: その日の写真のうち、時刻のある予定のどれにも入らなかった写真
 */
export function isLinked(p: PhotoEntry, ev: DayEvent, dayEvents: DayEvent[]): boolean {
  if (p.linkRemove?.includes(ev.key)) return false
  if (p.linkAdd?.includes(ev.key)) return true
  if (!ev.allDay) return inTimed(p, ev)
  return !dayEvents.some((o) => !o.allDay && inTimed(p, o))
}

export const linkedPhotos = (day: DayData, ev: DayEvent, dayEvents: DayEvent[]) => day.photos.filter((p) => isLinked(p, ev, dayEvents))

/** 手動で紐づけ／外す(自動の結果と同じになるなら手動の記録は消す) */
export function setLink(p: PhotoEntry, ev: DayEvent, dayEvents: DayEvent[], on: boolean) {
  const add = new Set(p.linkAdd ?? [])
  const remove = new Set(p.linkRemove ?? [])
  add.delete(ev.key)
  remove.delete(ev.key)
  const auto = isLinked({ ...p, linkAdd: [], linkRemove: [] }, ev, dayEvents)
  if (on && !auto) add.add(ev.key)
  if (!on && auto) remove.add(ev.key)
  p.linkAdd = add.size ? [...add] : undefined
  p.linkRemove = remove.size ? [...remove] : undefined
}
