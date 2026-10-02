import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { monthGrid, ymd } from './lib/dates'
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
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() })
  const [selected, setSelected] = useState(ymd(today))
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [indexes, setIndexes] = useState<Record<string, YearIndex>>({})
  const [rev, setRev] = useState(0)
  const [inboxCount, setInboxCount] = useState(0)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<'import' | 'settings' | null>(null)
  const [viewer, setViewer] = useState<{ day: DayData; file: string; files: string[] } | null>(null)

  const google = useGoogle()
  const newer = useNewerVersion()
  const grid = monthGrid(cursor.y, cursor.m)
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

  // 表示中の月にかかる年の索引
  const years = [...new Set([grid.start.getFullYear(), cursor.y, grid.end.getFullYear()])]
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

  const move = (n: number) => setCursor(({ y, m }) => ({ y: new Date(y, m + n, 1).getFullYear(), m: new Date(y, m + n, 1).getMonth() }))
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
          <button className="icon" onClick={() => move(-1)} aria-label="前の月">
            ‹
          </button>
          <span className="title">
            {cursor.y}年{cursor.m + 1}月
          </span>
          <button className="icon" onClick={() => move(1)} aria-label="次の月">
            ›
          </button>
          <button className="small ghost" onClick={goToday}>
            今日
          </button>
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

      <main className="layout">
        <MonthView lib={lib} year={cursor.y} month0={cursor.m} days={days} byDay={allEv.byDay} selected={selected} onSelect={setSelected} />
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
