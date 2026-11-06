import { WEEKDAYS, monthGrid, ymd } from '../lib/dates'
import { holidayName } from '../lib/holidays'
import type { DayEvent } from '../lib/events'
import type { Library } from '../storage/library'
import type { DaySummary } from '../storage/model'
import Thumb from './Thumb'

interface Props {
  lib: Library
  year: number
  days: Record<string, DaySummary>
  byDay: Map<string, DayEvent[]>
  onPickDay: (date: string) => void
  onPickMonth: (month0: number) => void
}

/** 年表示: 12か月の小さなカレンダー。写真のある日は表紙の写真、予定のある日は点を付ける */
export default function YearView({ lib, year, days, byDay, onPickDay, onPickMonth }: Props) {
  const today = ymd(new Date())
  return (
    <div className="year">
      {Array.from({ length: 12 }, (_, month0) => {
        const grid = monthGrid(year, month0).days
        // 6週目がすべて翌月なら省く
        const shown = grid[35].getMonth() !== month0 ? grid.slice(0, 35) : grid
        const monthDays = shown.filter((d) => d.getMonth() === month0).map(ymd)
        const photoCount = monthDays.reduce((n, k) => n + (days[k]?.count ?? 0), 0)
        return (
          <section key={month0} className="mini">
            <button type="button" className="mini-title" onClick={() => onPickMonth(month0)} title="月表示で開く">
              {month0 + 1}月{photoCount > 0 && <span className="mini-count">📷{photoCount}</span>}
            </button>
            <div className="mini-grid">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={`mini-wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>
                  {w}
                </div>
              ))}
              {shown.map((d) => {
                const key = ymd(d)
                if (d.getMonth() !== month0) return <div key={key} />
                const s = days[key]
                const evs = byDay.get(key) ?? []
                const hol = holidayName(d.getFullYear(), d.getMonth() + 1, d.getDate())
                const cls = ['mini-day', hol || d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : '', key === today && 'today', s?.cover && 'has-photo']
                  .filter(Boolean)
                  .join(' ')
                const tip = [hol, s?.count && `写真 ${s.count} 枚`, s?.memo && 'メモあり', evs.length && `予定 ${evs.length} 件`].filter(Boolean).join('・')
                return (
                  <button key={key} type="button" className={cls} onClick={() => onPickDay(key)} title={tip}>
                    {s?.cover && <Thumb lib={lib} date={key} file={s.cover} className="mini-cover" />}
                    <span className="mini-num">{d.getDate()}</span>
                    {evs.length > 0 && <span className="mini-dot" style={{ background: evs[0].color }} />}
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
