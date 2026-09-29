export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

const p2 = (n: number) => String(n).padStart(2, '0')

/** 2026-09-29 の形(端末の時刻で) */
export const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`

/** 2026-09-29T10:15:00 の形(時差なし・端末の時刻で)。写真の撮影日時の保存に使う */
export const localIso = (d: Date) => `${ymd(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`

export const hhmm = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`

export const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

export const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b)

/** 月表示の6週分の日付(日曜始まり) */
export function monthGrid(year: number, month0: number): { start: Date; end: Date; days: Date[] } {
  const first = new Date(year, month0, 1)
  const start = addDays(first, -first.getDay())
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  return { start, end: addDays(start, 42), days }
}

/** 2026年9月29日(火) */
export const jpDate = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`
