// OAuth クライアント ID は公開前提の値(シークレットではない)。WebCalendar と同じものを使う
export const GOOGLE_CLIENT_ID =
  '751716491065-iv92cgd68fvlpshe34lmg8g7t3ocnf6m.apps.googleusercontent.com'

// 読み取り専用の権限だけを求める。Google 側の仕様で、この権限では予定の作成・変更・削除は不可能
export const SCOPE_CALENDAR_READONLY = 'https://www.googleapis.com/auth/calendar.readonly'
