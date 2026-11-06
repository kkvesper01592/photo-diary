import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addDays, monthGrid, parseYmd, weekOf, ymd, WEEKDAYS, type ViewKind } from './lib/dates'
import { useNewerVersion, versionDetail, versionLabel } from './lib/version'
import { isLinked } from './lib/events'
import { useAllEvents, useGoogle } from './google/useGoogle'
import { canPickFolder, loadSavedRoot, permissionOf, pickRoot, requestPermission, saveRoot } from './storage/fs'
import { scanInbox } from './storage/importer'
import { Library } from './storage/library'
import { DEFAULT_SETTINGS, type DayData, type DaySummary, type Settings, type YearIndex } from './storage/model'
import DayPanel from './views/DayPanel'
import ImportPanel from './views/ImportPanel'
import MonthView from './views/MonthView'
import PhotoViewer from './views/PhotoViewer'
import SettingsPanel from './views/SettingsPanel'
import TimeGridView from './views/TimeGridView'
import YearView from './views/YearView'

const VIEWS: { kind: ViewKind; label: string }[] = [
  { kind: 'year', label: '年' },
  { kind: 'month', label: '月' },
  { kind: 'week', label: '週' },
  { kind: 'day', label: '日' },
]
const VIEW_KEY = 'photodiary.view'
function loadView(): ViewKind {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    if (VIEWS.some((x) => x.kind === v)) return v as ViewKind
  } catch {
    /* 読めなければ月表示 */
  }
  return 'month'
}
function saveView(v: ViewKind) {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    /* 覚えられなくても表示には影響しない */
  }
}

type Gate =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'nofolder' }
  | { kind: 'prompt'; handle: FileSystemDirectoryHandle }
  | { kind: 'ready'; lib: Library }

declare global {
  interface Window {
    __demoRoot?: FileSystemDirectoryHandle // 開発用デモ(?demo)の保存フォルダ
  }
}

export default function App() {
  const [gate, setGate] = useState<Gate>({ kind: 'loading' })
  const [gateError, setGateError] = useState('')

  useEffect(() => {
    ;(async () => {
      if (window.__demoRoot) return setGate({ kind: 'ready', lib: new Library(window.__demoRoot) })
      if (!canPickFolder()) return setGate({ kind: 'unsupported' })
      const h = await loadSavedRoot()
      if (!h) return setGate({ kind: 'nofolder' })
      setGate((await permissionOf(h)) === 'granted' ? { kind: 'ready', lib: new Library(h) } : { kind: 'prompt', handle: h })
    })().catch((e) => {
      setGateError(String(e))
      setGate({ kind: 'nofolder' })
    })
  }, [])

  const choose = async () => {
    setGateError('')
    try {
      const h = await pickRoot()
      await saveRoot(h)
      const lib = new Library(h)
      await lib.ensureInbox()
      setGate({ kind: 'ready', lib })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setGateError(e instanceof Error ? e.message : String(e))
    }
  }

  const allow = async (h: FileSystemDirectoryHandle) => {
    setGateError('')
    try {
      if (await requestPermission(h)) setGate({ kind: 'ready', lib: new Library(h) })
      else setGateError('フォルダの利用が許可されませんでした')
    } catch (e) {
      setGateError(`フォルダに接続できませんでした(NAS の電源・ネットワークを確認してください): ${e instanceof Error ? e.message : e}`)
    }
  }

  if (gate.kind === 'ready') return <Main key={gate.lib.root.name} lib={gate.lib} onChangeFolder={() => void choose()} />

  return (
    <div className="gate">
      <h1>📷 写真日記</h1>
      <p className="muted small-text">{versionDetail}</p>
      {gate.kind === 'loading' && <p className="muted">読み込み中…</p>}
      {gate.kind === 'unsupported' && <p className="error">このブラウザでは使えません。PC の Microsoft Edge または Google Chrome で開いてください。</p>}
      {gate.kind === 'nofolder' && (
        <>
          <p>写真とメモを保存するフォルダを選んでください。</p>
          <p className="muted small-text">
            NAS の上のフォルダがおすすめです。複数の PC から同じフォルダを選べば、どの PC でも同じ写真・メモを見られます。
            後から設定で変更できます。
          </p>
          <button onClick={() => void choose()}>保存フォルダを選ぶ</button>
        </>
      )}
      {gate.kind === 'prompt' && (
        <>
          <p>
            保存フォルダ「<strong>{gate.handle.name}</strong>」に接続します。
          </p>
          <p className="muted small-text">ブラウザの決まりで、起動のたびにフォルダの利用の許可が必要な場合があります。</p>
          <button onClick={() => void allow(gate.handle)}>接続する</button>{' '}
          <button className="ghost" onClick={() => void choose()}>
            別のフォルダを選ぶ
          </button>
        </>
      )}
      {gateError && <p className="error">{gateError}</p>}
    </div>
  )
}

function Main({ lib, onChangeFolder }: { lib: Library; onChangeFolder: () => void }) {
  const today = new Date()
  const [view, setView] = useState<ViewKind>(loadView)
  // 年・月表示で見ている月(週・日表示は選んだ日 selected が基準)
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() })
  const [selected, setSelected] = useState(ymd(today))
  const [dayData, setDayData] = useState<Record<string, DayData>>({})
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [indexes, setIndexes] = useState<Record<string, YearIndex>>({})
  const [rev, setRev] = useState(0)
  const [inboxCount, setInboxCount] = useState(0)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<'import' | 'settings' | null>(null)
  const [viewer, setViewer] = useState<{ day: DayData; file: string; files: string[] } | null>(null)

  const google = useGoogle()
  const newer = useNewerVersion()
  const selDate = parseYmd(selected)
  const weekDates = weekOf(selDate)
  // 表示中の期間(索引を読む年を決めるため)
  let range: { start: Date; end: Date }
  if (view === 'year') range = { start: new Date(cursor.y, 0, 1), end: new Date(cursor.y, 11, 31) }
  else if (view === 'month') {
    const g = monthGrid(cursor.y, cursor.m)
    range = { start: g.start, end: addDays(g.end, -1) }
  } else if (view === 'week') range = { start: weekDates[0], end: weekDates[6] }
  else range = { start: selDate, end: selDate }
  const allEv = useAllEvents(lib, google.token, google.calendars, settings.hiddenCalendarIds, google.onAuthError)

  const bump = useCallback(() => setRev((r) => r + 1), [])

  // 設定・取り込み用フォルダの枚数(保存フォルダから。ほかの PC の変更も拾うため、画面に戻るたびに読み直す)
  useEffect(() => {
    lib
      .loadSettings()
      .then(({ restored, ...s }) => {
        setSettings(s)
        if (restored) setSettingsRestored(restored)
      })
      .catch((e) => setError(String(e)))
    scanInbox(lib)
      .then((s) => setInboxCount(s.files.length))
      .catch(() => {})
  }, [lib, rev])

  // 表示中の期間にかかる年の索引
  const years = [...new Set([range.start.getFullYear(), range.end.getFullYear()])]
  const yearsKey = years.join(',')
  useEffect(() => {
    let alive = true
    Promise.all(years.map(async (y) => [String(y), await lib.loadIndex(y)] as const))
      .then((list) => {
        if (!alive) return
        setIndexes(Object.fromEntries(list))
        setError('')
      })
      .catch((e) => alive && setError(`保存フォルダを読めませんでした(NAS の接続を確認してください): ${e instanceof Error ? e.message : e}`))
    return () => void (alive = false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib, yearsKey, rev])

  const days = useMemo(() => Object.assign({}, ...Object.values(indexes).map((i) => i.days)) as Record<string, DaySummary>, [indexes])

  // 週・日表示: 写真のある日の中身を読む(撮影時刻の位置に写真を並べるため)
  const shownDates = view === 'week' ? weekDates.map(ymd) : view === 'day' ? [selected] : []
  const photoDatesKey = shownDates.filter((k) => days[k]?.count).join(',')
  useEffect(() => {
    let alive = true
    const keys = photoDatesKey ? photoDatesKey.split(',') : []
    Promise.all(keys.map(async (k) => [k, await lib.loadDay(k)] as const))
      .then((list) => alive && setDayData(Object.fromEntries(list)))
      .catch(() => {})
    return () => void (alive = false)
  }, [lib, photoDatesKey, rev])

  // ほかの PC での変更を拾うため、画面に戻ったら読み直す(写真を見ている間は除く)
  const lastFocus = useRef(0)
  useEffect(() => {
    const h = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastFocus.current < 5000) return
      lastFocus.current = Date.now()
      bump()
    }
    window.addEventListener('focus', h)
    document.addEventListener('visibilitychange', h)
    return () => {
      window.removeEventListener('focus', h)
      document.removeEventListener('visibilitychange', h)
    }
  }, [bump])

  const changeView = (v: ViewKind, monthOf = selDate) => {
    setView(v)
    saveView(v)
    // 年・月表示に切り替えたら、選んでいる日の月を出す
    if (v === 'year' || v === 'month') setCursor({ y: monthOf.getFullYear(), m: monthOf.getMonth() })
  }
  const move = (n: number) => {
    if (view === 'week' || view === 'day') {
      const d = addDays(selDate, n * (view === 'week' ? 7 : 1))
      setSelected(ymd(d))
      setCursor({ y: d.getFullYear(), m: d.getMonth() })
      return
    }
    setCursor(({ y, m }) => {
      const d = view === 'year' ? new Date(y + n, m, 1) : new Date(y, m + n, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }
  const showDay = (date: string) => {
    setSelected(date)
    changeView('day', parseYmd(date))
  }
  const ymdJp = (d: Date, withYear = true, withMonth = true) =>
    `${withYear ? `${d.getFullYear()}年` : ''}${withMonth ? `${d.getMonth() + 1}月` : ''}${d.getDate()}日`
  let title: string
  if (view === 'year') title = `${cursor.y}年`
  else if (view === 'month') title = `${cursor.y}年${cursor.m + 1}月`
  else if (view === 'week') {
    const [s, e] = [weekDates[0], weekDates[6]]
    const sameYear = s.getFullYear() === e.getFullYear()
    title = `${ymdJp(s)}〜${ymdJp(e, !sameYear, !sameYear || s.getMonth() !== e.getMonth())}`
  } else title = `${ymdJp(selDate)}(${WEEKDAYS[selDate.getDay()]})`
  const unit = view === 'year' ? '年' : view === 'month' ? '月' : view === 'week' ? '週' : '日'
  const goDate = (date: string) => {
    const [y, m] = date.split('-').map(Number)
    setCursor({ y, m: m - 1 })
    setSelected(date)
  }
  const goToday = () => goDate(ymd(new Date()))

  const [settingsRestored, setSettingsRestored] = useState('')
  const saveSettings = async (s: Settings) => {
    await lib.saveSettings(s)
    setSettings(s)
  }

  const dayEvents = allEv.byDay.get(selected) ?? []

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">📷 写真日記</span>
        <div className="nav">
          <button className="icon" onClick={() => move(-1)} aria-label={`前の${unit}`}>
            ‹
          </button>
          <span className="title">{title}</span>
          <button className="icon" onClick={() => move(1)} aria-label={`次の${unit}`}>
            ›
          </button>
          <button className="small ghost" onClick={goToday}>
            今日
          </button>
        </div>
        <div className="seg" role="tablist" aria-label="表示の切り替え">
          {VIEWS.map((v) => (
            <button key={v.kind} type="button" role="tab" aria-selected={view === v.kind} className={view === v.kind ? 'on' : ''} onClick={() => changeView(v.kind)}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="menu">
          <button className="small" onClick={() => setModal('import')}>
            取り込み{inboxCount > 0 && <span className="badge" title={`取り込み用フォルダに写真が ${inboxCount} 枚あります`}>{inboxCount}</span>}
          </button>
          {google.token ? (
            <button
              className="small ghost"
              onClick={allEv.reload}
              disabled={allEv.loading}
              title={allEv.fetchedAt && `前回の読み込み: ${new Date(allEv.fetchedAt).toLocaleString('ja-JP')}`}
            >
              {allEv.loading ? '予定を読み込み中…' : '予定を更新'}
            </button>
          ) : (
            <button className="small ghost" onClick={() => void google.login()} title="予定を読み込むため(読み取りのみ)">
              Google にログイン
            </button>
          )}
          <button className="small ghost" onClick={() => setModal('settings')}>
            設定
          </button>
          <button className="version-tag" title={`${versionDetail}(押すと設定で詳しく表示)`} onClick={() => setModal('settings')}>
            {versionLabel}
          </button>
        </div>
      </header>

      {newer && (
        <div className="banner">
          新しいヴァージョン(ver {newer.version}・{newer.built}・ビルド {newer.commit})が公開されています。
          <button className="small" onClick={() => window.location.reload()}>
            再読み込みして更新
          </button>
        </div>
      )}

      {error && <div className="banner warn-banner">{error}</div>}
      {settingsRestored && (
        <div className="banner">
          設定ファイルが見つからなかったため、{settingsRestored}から設定を戻しました。
          <button className="small ghost" onClick={() => setSettingsRestored('')}>
            閉じる
          </button>
        </div>
      )}
      {google.error && <div className="banner warn-banner">{google.error}</div>}
      {google.expired && (
        <div className="banner">
          Google のログインの有効期限が切れました。
          <button className="small" onClick={() => void google.login()}>
            もう一度ログイン
          </button>
        </div>
      )}
      {allEv.error && <div className="banner warn-banner">{allEv.error}</div>}
      {allEv.loading ? (
        <div className="banner small-text">Google から全期間の予定を読み込んでいます…</div>
      ) : (
        !google.token &&
        allEv.fetchedAt && (
          <div className="banner small-text">
            前回ログインしたときの予定({new Date(allEv.fetchedAt).toLocaleString('ja-JP')} 時点・{allEv.count.toLocaleString()} 件
            {allEv.source === 'folder' && '・保存フォルダの控えから復元'})を表示しています。最新にするには Google にログインしてください。
          </div>
        )
      )}

      <main className={`layout ${view === 'year' ? 'no-panel' : ''}`}>
        {view === 'year' ? (
          <YearView
            lib={lib}
            year={cursor.y}
            days={days}
            byDay={allEv.byDay}
            onPickDay={showDay}
            onPickMonth={(m) => changeView('month', new Date(cursor.y, m, 1))}
          />
        ) : view === 'month' ? (
          <MonthView lib={lib} year={cursor.y} month0={cursor.m} days={days} byDay={allEv.byDay} selected={selected} onSelect={setSelected} />
        ) : (
          <TimeGridView
            lib={lib}
            dates={view === 'week' ? weekDates : [selDate]}
            byDay={allEv.byDay}
            days={days}
            dayData={dayData}
            selected={selected}
            onSelect={setSelected}
            onPickDay={view === 'week' ? showDay : undefined}
            onOpenPhoto={(day, file) => setViewer({ day, file, files: [...day.photos].sort((a, b) => a.takenAt.localeCompare(b.takenAt)).map((p) => p.file) })}
          />
        )}
        {view !== 'year' && (
        <DayPanel
          lib={lib}
          date={selected}
          dayEvents={dayEvents}
          rev={rev}
          onSaved={bump}
          onOpenPhoto={(day, file, filterKey) => {
            const ev = dayEvents.find((e) => e.key === filterKey)
            const list = ev ? day.photos.filter((p) => isLinked(p, ev, dayEvents)) : day.photos
            setViewer({ day, file, files: list.map((p) => p.file) })
          }}
        />
        )}
      </main>

      {viewer && (
        <PhotoViewer
          lib={lib}
          day={viewer.day}
          dayEvents={allEv.byDay.get(viewer.day.date) ?? []}
          files={viewer.files}
          file={viewer.file}
          onMove={(file) => setViewer((v) => v && { ...v, file })}
          onClose={() => setViewer(null)}
          onSaved={(day) => {
            setViewer((v) => v && { ...v, day })
            bump()
          }}
          onDeleted={(day, next) => {
            setViewer((v) => (v && next ? { day, file: next, files: v.files.filter((f) => day.photos.some((p) => p.file === f)) } : null))
            bump()
          }}
        />
      )}
      {modal === 'import' && (
        <ImportPanel
          lib={lib}
          settings={settings}
          onClose={() => setModal(null)}
          onImported={(dates) => {
            bump()
            if (dates.length === 1) goDate(dates[0])
          }}
          onJump={(d) => {
            setModal(null)
            goDate(d)
          }}
        />
      )}
      {modal === 'settings' && (
        <SettingsPanel
          lib={lib}
          settings={settings}
          onChange={saveSettings}
          calendars={allEv.calendars}
          loggedIn={!!google.token}
          onLogin={() => void google.login()}
          onLogout={() => void google.logout()}
          onChangeFolder={() => {
            setModal(null)
            onChangeFolder()
          }}
          onRebuilt={bump}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
