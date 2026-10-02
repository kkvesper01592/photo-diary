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
  const [settingsHistory, setSettingsHistory] = useState<{ name: string; label: string }[] | null>(null)
  const [historyPick, setHistoryPick] = useState('')

  const openSettingsHistory = async () => {
    setError('')
    try {
      const list = await lib.listSettingsHistory()
      setSettingsHistory(list)
      setHistoryPick(list[0]?.name ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const restoreSettings = async () => {
    if (!historyPick) return
    if (!window.confirm('選んだ時点の設定に戻しますか？(今の設定も履歴に残ります)')) return
    try {
      await p.onChange(await lib.loadSettingsHistory(historyPick))
      setMsg('設定を戻しました')
      setSettingsHistory(null)
    } catch (e) {
      setError(`設定を戻せませんでした: ${e instanceof Error ? e.message : e}`)
    }
  }
  // 写真をすべて削除
  const [delAll, setDelAll] = useState<{ photos: number; days: number } | null>(null)
  const [backedUp, setBackedUp] = useState(false)
  const [delProgress, setDelProgress] = useState('')
  const [deleting, setDeleting] = useState(false)

  const openDelAll = async () => {
    setError('')
    setMsg('')
    try {
      setBackedUp(false)
      setDelProgress('')
      setDelAll(await lib.countAll())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const runDelAll = async () => {
    setDeleting(true)
    setError('')
    try {
      const n = await lib.deleteAllPhotos((date, done) => setDelProgress(`削除中… ${done} 枚目(${date})`))
      setDelAll(null)
      setMsg(`写真 ${n} 枚を削除しました(メモは残しています)`)
      p.onRebuilt()
    } catch (e) {
      setError(`削除の途中で止まりました: ${e instanceof Error ? e.message : e}`)
    } finally {
      setDeleting(false)
    }
  }

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
          <label className="opt">
            <input type="checkbox" checked={settings.skipDuplicates} onChange={(e) => void change({ skipDuplicates: e.target.checked })} />
            重複の確認をする(同じ撮影日に、同じファイル名・同じ中身の写真が取り込み済みなら取り込まない)
          </label>
          <p className="muted small-text">
            オフにすると、取り込み用フォルダの写真をすべて取り込みます(同じ名前の写真があれば、名前に _2 などを付けて保存します)。
          </p>
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

        <section className="set-sec">
          <h3>設定の控え</h3>
          <p className="muted small-text">
            設定は、保存フォルダの「写真日記_設定.json」・設定を変えるたびの履歴(_写真日記のデータ\設定の履歴、最新50件)・この PC のブラウザの3か所に控えています。
            設定ファイルが消えたときは、自動で控えから戻します。
          </p>
          {settingsHistory === null ? (
            <button className="small ghost" onClick={() => void openSettingsHistory()}>
              設定の履歴から戻す…
            </button>
          ) : settingsHistory.length === 0 ? (
            <p className="small-text muted">まだ設定の履歴はありません</p>
          ) : (
            <div className="btns">
              <select value={historyPick} onChange={(e) => setHistoryPick(e.target.value)}>
                {settingsHistory.map((h) => (
                  <option key={h.name} value={h.name}>
                    {h.label}
                  </option>
                ))}
              </select>
              <button className="small" onClick={() => void restoreSettings()}>
                この設定に戻す
              </button>
              <button className="small ghost" onClick={() => setSettingsHistory(null)}>
                やめる
              </button>
            </div>
          )}
        </section>

        <section className="set-sec">
          <h3>写真をすべて削除</h3>
          <p className="muted small-text">
            写真を整理し直して取り込み直したいときに使います。登録されているすべての写真(原本・縮小版・サムネイル)を保存フォルダから完全に削除します。
            保存フォルダの中の、このアプリが作っていないフォルダ・ファイルや、取り込み用フォルダの中身には触りません。
          </p>
          <button className="small danger" onClick={() => void openDelAll()} disabled={deleting}>
            写真をすべて削除…
          </button>
        </section>

        {error && <p className="error">{error}</p>}
        {delAll && (
          <div className="modal-back confirm-back" onClick={() => !deleting && setDelAll(null)}>
            <div className="modal confirm" role="alertdialog" aria-modal="true" aria-label="写真をすべて削除" onClick={(e) => e.stopPropagation()}>
              <h2>写真をすべて完全に削除しますか？</h2>
              <p>
                保存フォルダ「<strong>{lib.rootName}</strong>」の写真 <strong>{delAll.photos.toLocaleString()} 枚</strong>({delAll.days.toLocaleString()} 日分)を削除します。
              </p>
              <p className="error">
                原本・縮小版・サムネイルのファイルと、写真の説明・予定との紐づけが消えます。
                <br />
                ごみ箱には入らず、<strong>元に戻すことはできません。</strong>
              </p>
              <p className="small-text">日ごとのメモは削除しません(写真を取り込み直せば、同じ日のメモと一緒に表示されます)。</p>
              <label className="opt">
                <input type="checkbox" checked={backedUp} onChange={(e) => setBackedUp(e.target.checked)} disabled={deleting} />
                必要な写真のバックアップを取ったことを確認しました
              </label>
              {delProgress && <p className="small-text">{delProgress}</p>}
              <div className="modal-foot">
                <button className="ghost" onClick={() => setDelAll(null)} disabled={deleting} autoFocus>
                  やめる
                </button>
                <button className="danger" onClick={() => void runDelAll()} disabled={deleting || !backedUp || !delAll.photos}>
                  {deleting ? '削除中…' : `${delAll.photos.toLocaleString()} 枚をすべて削除する`}
                </button>
              </div>
            </div>
          </div>
        )}
        <p className="muted small-text">
          写真日記 {versionDetail}
        </p>
      </div>
    </div>
  )
}
