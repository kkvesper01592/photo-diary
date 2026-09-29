// ビルドごとのヴァージョン情報(画面に表示し、新しい版が出たかの確認にも使う)
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function commit() {
  // GitHub Actions ではコミットの ID が環境変数に入っている
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    const id = execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim()
    const dirty = execSync('git status --porcelain --untracked-files=no', { encoding: 'utf8' }).trim()
    return dirty ? `${id}+変更あり` : id
  } catch {
    return 'dev'
  }
}

// 日本時間の日付(例 2026-09-27)
const built = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

export const buildInfo = { version: pkg.version, commit: commit(), built }
