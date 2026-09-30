import { holidayName } from '../lib/holidays'
import { WEEKDAYS, monthGrid, ymd } from '../lib/dates'
import type { DayEvent } from '../lib/events'
import type { Library } from '../storage/library'
import type { DaySummary } from '../storage/model'
import Thumb from './Thumb'

interface Props {
  lib: Library
  year: number
  month0: number
  days: Record<string, DaySummary>
  byDay: Map<string, DayEvent[]>
  selected: string
  onSelect: (date: string) => void
}

const MAX_CHIPS = 2

export default function MonthView({ lib, year, month0, days, byDay, selected, onSelect }: Props) {
  const grid = monthGrid(year, month0).days
  const today = ymd(new Date())
  return (
    <div className="month">
      <div className="month-head">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>
            {w}
          </div>
        ))}
      </div>
      <div className="month-grid">
        {grid.map((d) => {
          const key = ymd(d)
          const hol = holidayName(d.getFullYear(), d.getMonth() + 1, d.getDate())
          const s = days[key]
          const evs = byDay.get(key) ?? []
          const cls = [
            'cell',
            d.getMonth() !== month0 && 'other',
            key === today && 'today',
            key === selected && 'selected',
            hol || d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : '',
            s?.cover && 'has-photo',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button key={key} type="button" className={cls} onClick={() => onSelect(key)} title={hol}>
              {s?.cover && <Thumb lib={lib} date={key} file={s.cover} className="cell-cover" />}
              <div className="cell-top">
                <span className="daynum">{d.getDate()}</span>
                <span className="badges">
                  {s?.memo && <span title="メモあり">📝</span>}
                  {!!s?.count && <span className="count">📷{s.count}</span>}
                </span>
              </div>
              <div className="cell-bottom">
                {hol && !evs.some((e) => e.title === hol) && <div className="holiday">{hol}</div>}
                {evs.slice(0, MAX_CHIPS).map((e) => (
                  <div key={e.key} className="chip" style={{ borderLeftColor: e.color }}>
                    {e.title}
                  </div>
                ))}
                {evs.length > MAX_CHIPS && <div className="more">他 {evs.length - MAX_CHIPS} 件</div>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
