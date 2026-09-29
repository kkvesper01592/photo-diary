import { GOOGLE_CLIENT_ID } from '../config'

// Google Identity Services (GIS) の最小限の型
interface TokenResponse {
  access_token: string
  expires_in: number
  scope: string
  error?: string
  error_description?: string
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (res: TokenResponse) => void
            error_callback?: (err: { type: string; message?: string }) => void
          }): TokenClient
          hasGrantedAllScopes(res: TokenResponse, ...scopes: string[]): boolean
          revoke(token: string, done?: () => void): void
        }
      }
    }
  }
}

export interface AccessToken {
  value: string
  expiresAt: number
  scope: string
}

let gisPromise: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gisPromise = null
      reject(new Error('Google ログイン用スクリプトを読み込めませんでした'))
    }
    document.head.appendChild(s)
  })
  return gisPromise
}

export const hasScope = (token: AccessToken, scope: string) => token.scope.split(' ').includes(scope)

/** ポップアップで Google にログインし、アクセストークンを得る。トークンはメモリ上だけに保持する。
 * required が許可されなければ失敗。それ以外(optional)は許可されなくてもログインは続ける。
 * silent: 一度許可した後のログインし直し(有効期限の更新)。確認画面を出さず、ポップアップは自動で閉じる
 * (ブラウザの決まりで、ボタンを押した操作の中から呼ぶ必要がある) */
export async function requestAccessToken(required: string, optional: string[] = [], opts: { silent?: boolean } = {}): Promise<AccessToken> {
  await loadGis()
  const oauth2 = window.google!.accounts.oauth2
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: [required, ...optional].join(' '),
      callback: (res) => {
        if (res.error) return reject(new Error(res.error_description || res.error))
        if (!oauth2.hasGrantedAllScopes(res, required)) {
          return reject(new Error('カレンダーの閲覧が許可されませんでした。チェックを入れて再度ログインしてください'))
        }
        resolve({ value: res.access_token, expiresAt: Date.now() + res.expires_in * 1000, scope: res.scope })
      },
      error_callback: (err) =>
        reject(
          new Error(
            err.type === 'popup_closed'
              ? 'ログイン画面が閉じられました'
              : err.type === 'popup_failed_to_open'
                ? 'ログイン用の小さな画面を開けませんでした。ブラウザでこのサイトのポップアップが許可されているか確認してください'
                : err.message || err.type,
          ),
        ),
    })
    client.requestAccessToken(opts.silent ? { prompt: '' } : undefined)
  })
}

export function revokeToken(token: AccessToken): Promise<void> {
  return new Promise((resolve) => window.google!.accounts.oauth2.revoke(token.value, () => resolve()))
}
