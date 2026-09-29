import { useEffect, useState } from 'react'

// ビルド時に vite.config.ts が埋め込むヴァージョン情報

export const buildInfo = __BUILD_INFO__
/** 画面に出す短い表示(例 ver 1.1.0) */
export const versionLabel = `ver ${buildInfo.version}`
/** 詳しい表示(例 ver 1.1.0・2026-09-27・ビルド 2b41c5c) */
export const versionDetail = `${versionLabel}・${buildInfo.built}・ビルド ${buildInfo.commit}`

/**
 * 公開先の version.json を見て、今開いている画面より新しい版が出ていればその情報を返す。
 * 起動時・30分ごと・画面に戻ったとき・ネットにつながったときに確認する(開発版では確認しない)
 */
export function useNewerVersion() {
  const [newer, setNewer] = useState<typeof buildInfo | null>(null)
  useEffect(() => {
    if (import.meta.env.DEV) return
    let stop = false
    const check = async () => {
      if (!navigator.onLine || document.visibilityState === 'hidden') return
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' })
        if (!res.ok) return
        const info = (await res.json()) as typeof buildInfo
        if (!stop && info.commit && info.commit !== buildInfo.commit) setNewer(info)
      } catch {
        /* つながらないときは次の機会に */
      }
    }
    check()
    const timer = window.setInterval(check, 30 * 60_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('online', check)
    return () => {
      stop = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('online', check)
    }
  }, [])
  return newer
}
