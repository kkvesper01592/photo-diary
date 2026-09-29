// 日本の祝日(内閣府の「国民の祝日」の規則を実装)。2000〜2099年を対象とする。
// 振替休日・国民の休日・2019〜2021年の特例も含む。

const key = (m: number, d: number) => `${m}-${d}`

// その月の第 n 月曜日
function nthMonday(y: number, m: number, n: number): number {
  const first = new Date(y, m - 1, 1).getDay()
  return 1 + ((8 - first) % 7) + (n - 1) * 7
}

const shunbun = (y: number) => Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))
const shubun = (y: number) => Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))

function baseHolidays(y: number): Map<string, string> {
  const h = new Map<string, string>()
  const add = (m: number, d: number, name: string) => h.set(key(m, d), name)

  add(1, 1, '元日')
  add(1, nthMonday(y, 1, 2), '成人の日')
  add(2, 11, '建国記念の日')
  if (y >= 2020) add(2, 23, '天皇誕生日')
  add(3, shunbun(y), '春分の日')
  add(4, 29, y >= 2007 ? '昭和の日' : 'みどりの日')
  add(5, 3, '憲法記念日')
  if (y >= 2007) add(5, 4, 'みどりの日')
  add(5, 5, 'こどもの日')

  if (y === 2020) add(7, 23, '海の日')
  else if (y === 2021) add(7, 22, '海の日')
  else if (y >= 2003) add(7, nthMonday(y, 7, 3), '海の日')
  else add(7, 20, '海の日')

  if (y === 2020) add(8, 10, '山の日')
  else if (y === 2021) add(8, 8, '山の日')
  else if (y >= 2016) add(8, 11, '山の日')

  if (y >= 2003) add(9, nthMonday(y, 9, 3), '敬老の日')
  else add(9, 15, '敬老の日')
  add(9, shubun(y), '秋分の日')

  if (y === 2020) add(7, 24, 'スポーツの日')
  else if (y === 2021) add(7, 23, 'スポーツの日')
  else add(10, nthMonday(y, 10, 2), y >= 2020 ? 'スポーツの日' : '体育の日')

  add(11, 3, '文化の日')
  add(11, 23, '勤労感謝の日')
  if (y <= 2018) add(12, 23, '天皇誕生日')

  if (y === 2019) {
    add(4, 30, '国民の休日')
    add(5, 1, '天皇の即位の日')
    add(5, 2, '国民の休日')
    add(10, 22, '即位礼正殿の儀の行われる日')
  }
  return h
}

const cache = new Map<number, Map<string, string>>()

/** その年の祝日一覧。キーは "月-日" */
export function holidaysOf(y: number): Map<string, string> {
  const cached = cache.get(y)
  if (cached) return cached
  const h = baseHolidays(y)
  const isHoliday = (d: Date) => d.getFullYear() === y && h.has(key(d.getMonth() + 1, d.getDate()))

  // 国民の休日: 前日と翌日が祝日の平日(日曜以外)
  for (let m = 1; m <= 12; m++) {
    const days = new Date(y, m, 0).getDate()
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m - 1, d)
      if (h.has(key(m, d)) || date.getDay() === 0) continue
      const prev = new Date(y, m - 1, d - 1)
      const next = new Date(y, m - 1, d + 1)
      if (isHoliday(prev) && isHoliday(next) && !baseHolidays(y).has(key(m, d))) h.set(key(m, d), '国民の休日')
    }
  }

  // 振替休日: 日曜の祝日の後の、最初の祝日でない日
  for (const k of [...baseHolidays(y).keys()]) {
    const [m, d] = k.split('-').map(Number)
    if (new Date(y, m - 1, d).getDay() !== 0) continue
    const sub = new Date(y, m - 1, d + 1)
    while (isHoliday(sub)) sub.setDate(sub.getDate() + 1)
    if (sub.getFullYear() === y) h.set(key(sub.getMonth() + 1, sub.getDate()), '振替休日')
  }

  cache.set(y, h)
  return h
}

export function holidayName(y: number, m: number, d: number): string | undefined {
  return holidaysOf(y).get(key(m, d))
}
