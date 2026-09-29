import { useState } from 'react'
import type { CalendarListEntry } from '../google/calendarApi'
import type { Library } from '../storage/library'
import type { Settings } from '../storage/model'
import { versionDetail } from '../lib/version'

interface Props {
  lib: Library
  settings: Settings
  onChange: (s: Settings) => Promise<void>
  calendars: CalendarListEntry[]
  loggedIn: boolean
  onLogin: () => void
  onLogout: () => void
  onChangeFolder: () => void
  onRebuilt: () => void
  onClose: () => void
}

const SIZES = [1600, 1920, 2560, 3200]

export default function SettingsPanel(p: Props) {
  const { lib, settings } = p
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const change = async (s: Partial<Settings>) => {
    setError('')
    try {
      await p.onChange({ ...settings, ...s })
    } catch (e) {
      setError(`設定を保存できませんでした: ${e instanceof Error ? e.message : e}`)
    }
  }

  const hidden = new Set(settings.hiddenCalendarIds)
  const toggleCal = (id: string, show: boolean) => {
    const h = new Set(hidden)
    if (show) h.delete(id)
    else h.add(id)
    void change({ hiddenCalendarIds: [...h] })
  }

  const rebuild = async () => {
    setBusy(true)
    setMsg('')
    setError('')
    try {
      const n = await lib.rebuildIndexes((d) => setMsg(`確認中: ${d}`))
      setMsg(`索引を作り直しました(写真・メモのある日: ${n} 日)`)
      p.onRebuilt()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-back" onClick={p.onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="設定" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>設定</h2>
          <button className="icon" onClick={p.onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <p className="muted small-text">ここでの設定は保存フォルダに保存されるので、どの PC から開いても同じになります(保存フォルダの場所だけは PC ごと)。</p>

        <section className="set-sec">
          <h3>保存フォルダ</h3>
          <p>
            <strong>{lib.rootName}</strong>{' '}
            <button className="small ghost" onClick={p.onChangeFolder}>
              変更
            </button>
          </p>
          <p className="muted small-text">写真の原本・縮小版・メモはすべてこのフォルダに保存されます。</p>
        </section>

        <section className="set-sec">
          <h3>取り込み</h3>
          <label className="opt">
            縮小版の大きさ(長辺)
            <select value={settings.reducedLongEdge} onChange={(e) => void change({ reducedLongEdge: Number(e.target.value) })}>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}px{s === 1920 ? '(標準)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="opt">
            <input type="checkbox" checked={settings.removeFromInbox} onChange={(e) => void change({ removeFromInbox: e.target.checked })} />
            取り込めた写真は、取り込み用フォルダから消す(原本のコピーを確認してから消します)
          </label>
        </section>

        <section className="set-sec">
          <h3>予定を表示するカレンダー</h3>
          {!p.loggedIn && (
            <p className="small-text">
              <button className="small" onClick={p.onLogin}>
                Google にログイン
              </button>{' '}
              <span className="muted">(読み取りのみ。予定を変更・削除することはありません)</span>
            </p>
          )}
          {p.calendars.length === 0 ? (
            <p className="muted small-text">ログインするとカレンダーの一覧が表示されます</p>
          ) : (
            <>
              <ul className="cal-list">
                {p.calendars.map((c) => (
                  <li key={c.id}>
                    <label className="opt">
                      <input type="checkbox" checked={!hidden.has(c.id)} onChange={(e) => toggleCal(c.id, e.target.checked)} />
                      <span className="swatch" style={{ background: c.backgroundColor }} />
                      {c.summaryOverride || c.summary}
                    </label>
                  </li>
                ))}
              </ul>
              <button className="small ghost" onClick={() => void change({ hiddenCalendarIds: [] })} disabled={hidden.size === 0}>
                すべて表示
              </button>
            </>
          )}
          {p.loggedIn && (
            <p>
              <button className="small ghost" onClick={p.onLogout}>
                Google からログアウト
              </button>
            </p>
          )}
        </section>

        <section className="set-sec">
          <h3>メンテナンス</h3>
          <button className="small ghost" onClick={() => void rebuild()} disabled={busy}>
            月カレンダーの索引を作り直す
          </button>
          <p className="muted small-text">フォルダを手で動かしたときや、月カレンダーに写真が出ないときに使います(写真やメモは変更しません)。</p>
          {msg && <p className="small-text">{msg}</p>}
        </section>

        {error && <p className="error">{error}</p>}
        <p className="muted small-text">
          写真日記 {versionDetail}
        </p>
      </div>
    </div>
  )
}
