import type { Handler } from '@netlify/functions'

const ALLOWED_DOMAINS = [
  'lh3.googleusercontent.com',
  'dl.boxcloud.com',
  'api.box.com',
  'box.com',
  'drive.google.com',
  'storage.googleapis.com',
]

export const handler: Handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' }
  }

  const params = event.queryStringParameters ?? {}

  // Box: トークン認証でファイルダウンロード
  if (params.provider === 'box' && params.fileId && params.token) {
    try {
      const res = await fetch(`https://api.box.com/2.0/files/${params.fileId}/content`, {
        headers: { 'Authorization': `Bearer ${params.token}` },
        redirect: 'follow',
      })
      if (!res.ok) {
        return { statusCode: res.status, headers: corsHeaders, body: `Box error: ${res.status}` }
      }
      const contentType = res.headers.get('content-type') ?? 'image/jpeg'
      const buffer = await res.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': contentType, 'Cache-Control': 'private, max-age=3600' },
        body: base64,
        isBase64Encoded: true,
      }
    } catch (err) {
      return { statusCode: 502, headers: corsHeaders, body: 'Box fetch failed' }
    }
  }

  // URL経由プロキシ
  const rawUrl = params.url
  if (!rawUrl) {
    return { statusCode: 400, headers: corsHeaders, body: 'url parameter required' }
  }

  let targetUrl: string
  try {
    targetUrl = decodeURIComponent(rawUrl)
    const u = new URL(targetUrl)
    if (!ALLOWED_DOMAINS.some(d => u.hostname.endsWith(d))) {
      return { statusCode: 403, headers: corsHeaders, body: `Domain not allowed: ${u.hostname}` }
    }
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: 'Invalid URL' }
  }

  try {
    const response = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PhotoLinkMap/1.0)' },
      redirect: 'follow',
    })
    if (!response.ok) {
      return { statusCode: response.status, headers: corsHeaders, body: `Upstream error: ${response.status}` }
    }
    const contentType = response.headers.get('content-type') ?? 'image/jpeg'
    if (contentType.includes('text/html')) {
      return { statusCode: 403, headers: corsHeaders, body: 'HTML returned - check sharing settings' }
    }
    const buffer = await response.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' },
      body: base64,
      isBase64Encoded: true,
    }
  } catch (err) {
    return { statusCode: 502, headers: corsHeaders, body: 'Failed to fetch image' }
  }
}
