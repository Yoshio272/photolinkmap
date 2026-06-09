/**
 * Box OAuth 2.0 認証モジュール
 *
 * 認証フロー:
 *   ① ポップアップでBox認証ページを開く
 *   ② Box側でユーザーが許可
 *   ③ コールバックページへリダイレクト（code取得）
 *   ④ code → アクセストークン交換（Netlify Function経由）
 *   ⑤ トークンをlocalStorageに保存
 *   ⑥ 期限切れ前にリフレッシュ
 */

const BOX_AUTH_URL = 'https://account.box.com/api/oauth2/authorize'
const PROXY_URL    = '/.netlify/functions/box-proxy'

const LS_ACCESS  = 'box_access_token'
const LS_REFRESH = 'box_refresh_token'
const LS_EXPIRY  = 'box_token_expiry'
const LS_CLIENT  = 'box_client_id'
const LS_SECRET  = 'box_client_secret'

export interface BoxTokens {
  accessToken:  string
  refreshToken: string
  expiresAt:    number   // Unix ms
}

export interface BoxUserInfo {
  name:        string
  login:       string
  spaceUsed:   number   // bytes
  spaceAmount: number   // bytes
}

// ===== トークン保存・読込 =====

export function saveBoxTokens(tokens: BoxTokens, clientId: string, clientSecret: string): void {
  localStorage.setItem(LS_ACCESS,  tokens.accessToken)
  localStorage.setItem(LS_REFRESH, tokens.refreshToken)
  localStorage.setItem(LS_EXPIRY,  String(tokens.expiresAt))
  localStorage.setItem(LS_CLIENT,  clientId)
  localStorage.setItem(LS_SECRET,  clientSecret)
}

export function loadBoxTokens(): BoxTokens | null {
  const a = localStorage.getItem(LS_ACCESS)
  const r = localStorage.getItem(LS_REFRESH)
  const e = localStorage.getItem(LS_EXPIRY)
  if (!a || !r || !e) return null
  return { accessToken: a, refreshToken: r, expiresAt: Number(e) }
}

export function clearBoxTokens(): void {
  [LS_ACCESS, LS_REFRESH, LS_EXPIRY].forEach(k => localStorage.removeItem(k))
}

export function loadBoxCredentials(): { clientId: string; clientSecret: string } | null {
  const id = localStorage.getItem(LS_CLIENT)
  const sec = localStorage.getItem(LS_SECRET)
  return (id && sec) ? { clientId: id, clientSecret: sec } : null
}

export function isTokenExpired(tokens: BoxTokens): boolean {
  // 5分前に期限切れと判定
  return Date.now() > tokens.expiresAt - 5 * 60 * 1000
}

// ===== OAuth フロー =====

/**
 * ポップアップウィンドウでBox認証を開始
 * postMessage でコールバックコードを受け取る
 */
export function startBoxOAuth(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const redirectUri = `${window.location.origin}/auth/box/callback`
    const state = Math.random().toString(36).slice(2)
    const authUrl = `${BOX_AUTH_URL}?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`

    const popup = window.open(authUrl, 'box-oauth', 'width=600,height=700,scrollbars=yes')
    if (!popup) {
      reject(new Error('ポップアップがブロックされました。ブラウザのポップアップ許可設定を確認してください。'))
      return
    }

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('認証がタイムアウトしました'))
    }, 5 * 60 * 1000)  // 5分

    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      if (e.data?.type !== 'box-oauth-callback') return
      cleanup()
      if (e.data.error) reject(new Error(e.data.error))
      else resolve(e.data.code as string)
    }

    function cleanup() {
      clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
      popup?.close()
    }

    window.addEventListener('message', onMessage)
  })
}

/**
 * 認証コードをアクセストークンに交換（Netlify Function経由）
 */
export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<BoxTokens> {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'token_exchange', code, clientId, clientSecret }),
  })
  const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(data.error ?? 'トークン取得に失敗しました')
  }
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token ?? '',
    expiresAt:    Date.now() + (data.expires_in ?? 3600) * 1000,
  }
}

/**
 * リフレッシュトークンで新しいアクセストークンを取得
 */
export async function refreshBoxToken(tokens: BoxTokens): Promise<BoxTokens> {
  const creds = loadBoxCredentials()
  if (!creds) throw new Error('Box認証情報が見つかりません')

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'token_refresh',
      refreshToken: tokens.refreshToken,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    }),
  })
  const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(data.error ?? 'トークンのリフレッシュに失敗しました')
  }
  const newTokens: BoxTokens = {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    expiresAt:    Date.now() + (data.expires_in ?? 3600) * 1000,
  }
  saveBoxTokens(newTokens, creds.clientId, creds.clientSecret)
  return newTokens
}

/**
 * 有効なアクセストークンを返す（期限切れならリフレッシュ）
 */
export async function getValidToken(): Promise<string> {
  const tokens = loadBoxTokens()
  if (!tokens) throw new Error('Box未認証です。設定タブからサインインしてください。')

  if (isTokenExpired(tokens)) {
    const refreshed = await refreshBoxToken(tokens)
    return refreshed.accessToken
  }
  return tokens.accessToken
}
