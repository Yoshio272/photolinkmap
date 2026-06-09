/**
 * image-proxy.ts
 *
 * 360度画像のCORSプロキシ。
 * lh3.googleusercontent.com やその他のCORS制限されたURLから
 * 画像バイナリを取得し、ブラウザに返す。
 *
 * Photo Sphere ViewerはCORSを通過できる画像URLが必要なため、
 * このプロキシ経由で画像を提供する。
 *
 * 使用方法:
 *   /.netlify/functions/image-proxy?url=encodeURIComponent(imageUrl)
 */
import type { Handler } from '@netlify/functions'

// 許可するドメイン（セキュリティ）
const ALLOWED_DOMAINS = [
  'lh3.googleusercontent.com',
  'dl.boxcloud.com',
  'app.box.com',
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

  const rawUrl = event.queryStringParameters?.url
  if (!rawUrl) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'url parameter is required' }),
    }
  }

  let targetUrl: string
  try {
    targetUrl = decodeURIComponent(rawUrl)
    const u = new URL(targetUrl)
    if (!ALLOWED_DOMAINS.some(d => u.hostname.endsWith(d))) {
      return {
        statusCode: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Domain not allowed: ${u.hostname}` }),
      }
    }
  } catch {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid URL' }),
    }
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PhotoLinkMap/1.0)',
        'Referer': 'https://photolinkmap.netlify.app/',
      },
    })

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: corsHeaders,
        body: `Upstream error: ${response.status} ${response.statusText}`,
      }
    }

    const contentType = response.headers.get('content-type') ?? 'image/jpeg'
    const buffer = await response.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
      body: base64,
      isBase64Encoded: true,
    }
  } catch (err: unknown) {
    console.error('image-proxy error:', err)
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: 'Failed to fetch image',
    }
  }
}
