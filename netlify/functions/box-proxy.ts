/**
 * box-proxy.netlify.ts
 *
 * Box APIへのCORSプロキシ。
 * ブラウザからは直接Box APIを叩けないため、
 * Netlify Functionがサーバーサイドで中継する。
 *
 * エンドポイント: /.netlify/functions/box-proxy
 * Method: POST
 * Body: { action, token, ...params }
 */
import type { Handler } from '@netlify/functions'

const BOX_API = 'https://api.box.com/2.0'
const BOX_UPLOAD = 'https://upload.box.com/api/2.0'
const BOX_TOKEN_URL = 'https://api.box.com/oauth2/token'

interface ProxyRequest {
  action: string
  token?: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
  code?: string
  folderId?: string
  fileId?: string
  fileName?: string
  fileData?: string       // base64
  mimeType?: string
  folderName?: string
  parentFolderId?: string
  sharedLinkAccess?: 'open' | 'company' | 'collaborators'
}

async function boxFetch(url: string, token: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  const text = await res.text()
  let data: unknown
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  if (!res.ok) {
    const err = data as { message?: string; code?: string }
    throw { status: res.status, message: err.message ?? text, code: err.code }
  }
  return data
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  let req: ProxyRequest
  try { req = JSON.parse(event.body ?? '{}') }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) } }

  try {
    switch (req.action) {

      // ===== OAuth: 認証コードからトークン取得 =====
      case 'token_exchange': {
        const res = await fetch(BOX_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: req.code ?? '',
            client_id: req.clientId ?? '',
            client_secret: req.clientSecret ?? '',
          }),
        })
        const data = await res.json() as Record<string, unknown>
        if (!res.ok) throw { status: res.status, message: (data as { message?: string }).message ?? 'Token exchange failed' }
        return { statusCode: 200, headers, body: JSON.stringify(data) }
      }

      // ===== OAuth: トークンリフレッシュ =====
      case 'token_refresh': {
        const res = await fetch(BOX_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: req.refreshToken ?? '',
            client_id: req.clientId ?? '',
            client_secret: req.clientSecret ?? '',
          }),
        })
        const data = await res.json() as Record<string, unknown>
        if (!res.ok) throw { status: res.status, message: (data as { message?: string }).message ?? 'Token refresh failed' }
        return { statusCode: 200, headers, body: JSON.stringify(data) }
      }

      // ===== ファイル一覧取得 =====
      case 'list_files': {
        const data = await boxFetch(
          `${BOX_API}/folders/${req.folderId ?? '0'}/items?fields=id,name,type,size,created_at,shared_link&limit=500`,
          req.token ?? ''
        ) as { entries?: unknown[] }
        return { statusCode: 200, headers, body: JSON.stringify(data) }
      }

      // ===== フォルダ内検索（サブフォルダ含む）=====
      case 'search_files': {
        const data = await boxFetch(
          `${BOX_API}/search?query=${encodeURIComponent(req.fileName ?? '')}&ancestor_folder_ids=${req.folderId}&type=file&fields=id,name,type,shared_link&limit=200`,
          req.token ?? ''
        )
        return { statusCode: 200, headers, body: JSON.stringify(data) }
      }

      // ===== フォルダ作成 =====
      case 'create_folder': {
        const data = await boxFetch(`${BOX_API}/folders`, req.token ?? '', {
          method: 'POST',
          body: JSON.stringify({
            name: req.folderName,
            parent: { id: req.parentFolderId ?? '0' },
          }),
        })
        return { statusCode: 200, headers, body: JSON.stringify(data) }
      }

      // ===== ファイルアップロード =====
      case 'upload_file': {
        if (!req.fileData) throw { status: 400, message: 'fileData is required' }

        const binary = Buffer.from(req.fileData, 'base64')
        const boundary = `boundary_${Date.now()}`
        const metaJson = JSON.stringify({
          name: req.fileName,
          parent: { id: req.parentFolderId ?? '0' },
        })

        // multipart/form-data を手動構築
        const meta = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="attributes"\r\nContent-Type: application/json\r\n\r\n${metaJson}\r\n`
        )
        const fileHeader = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${req.fileName}"\r\nContent-Type: ${req.mimeType ?? 'application/octet-stream'}\r\n\r\n`
        )
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
        const body = Buffer.concat([meta, fileHeader, binary, footer])

        const res = await fetch(`${BOX_UPLOAD}/files/content`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${req.token}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(body.length),
          },
          body,
        })
        const data = await res.json() as Record<string, unknown>
        if (!res.ok) throw { status: res.status, message: (data as { message?: string }).message ?? 'Upload failed' }
        return { statusCode: 200, headers, body: JSON.stringify(data) }
      }

      // ===== 共有リンク生成 =====
      case 'create_shared_link': {
        const access = req.sharedLinkAccess ?? 'open'
        const data = await boxFetch(
          `${BOX_API}/files/${req.fileId}?fields=shared_link`,
          req.token ?? '',
          {
            method: 'PUT',
            body: JSON.stringify({ shared_link: { access, permissions: { can_download: true } } }),
          }
        ) as { shared_link?: { url?: string; download_url?: string } }
        return { statusCode: 200, headers, body: JSON.stringify(data) }
      }

      // ===== ファイル削除 =====
      case 'delete_file': {
        await boxFetch(`${BOX_API}/files/${req.fileId}`, req.token ?? '', { method: 'DELETE' })
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
      }

      // ===== フォルダ削除 =====
      case 'delete_folder': {
        await boxFetch(`${BOX_API}/folders/${req.folderId}?recursive=true`, req.token ?? '', { method: 'DELETE' })
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
      }

      // ===== ユーザー情報・容量取得 =====
      case 'get_user_info': {
        const data = await boxFetch(`${BOX_API}/users/me?fields=name,login,space_used,space_amount`, req.token ?? '')
        return { statusCode: 200, headers, body: JSON.stringify(data) }
      }

      // ===== サムネイル取得（base64で返す）=====
      case 'get_thumbnail': {
        const res = await fetch(
          `${BOX_API}/files/${req.fileId}/thumbnail.jpg?min_width=160&min_height=120`,
          { headers: { 'Authorization': `Bearer ${req.token}` } }
        )
        if (!res.ok) return { statusCode: 200, headers, body: JSON.stringify({ thumbnail: null }) }
        const buf = await res.arrayBuffer()
        const b64 = Buffer.from(buf).toString('base64')
        return { statusCode: 200, headers, body: JSON.stringify({ thumbnail: `data:image/jpeg;base64,${b64}` }) }
      }

      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${req.action}` }) }
    }
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string; code?: string }
    console.error('box-proxy error:', e)
    return {
      statusCode: e.status ?? 500,
      headers,
      body: JSON.stringify({ error: e.message ?? 'Internal error', code: e.code }),
    }
  }
}

// ===== 画像プロキシ（360度画像CORS回避）=====
// action: 'proxy_image'
// 追記: このcaseを handler の switch 内に追加が必要
// → 上記のhandler内に手動追加してください
