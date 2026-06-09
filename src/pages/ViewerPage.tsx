/**
 * /viewer ページ - Photo Sphere Viewer スタンドアロン
 *
 * URLパラメータ:
 *   type=photosphere   → PSV 360度ビューワー
 *   type=image         → Google Drive/Box リダイレクト
 *   fileId=xxx         → ストレージプロバイダーのファイルID
 *   storageProvider=   → 'google-drive' | 'box' (デフォルト: google-drive)
 *   title=xxx          → 表示タイトル（URLエンコード）
 *   url=xxx            → 直接URL（fileIdが無い場合）
 */
import { useEffect, useState } from 'react'
import type { ViewerType } from '../features/viewer/viewerTypes'
import { Viewer360Modal } from '../components/Viewer360'
import { resolve360ImageUrl, logViewerDebug } from '../features/viewer/imageResolver'

const VIEWER_LABELS: Partial<Record<ViewerType, string>> = {
  photosphere: '360度写真',
  image: '写真',
  video360: '360度動画',
  matterport: 'Matterport',
  drone: 'パノラマ',
}

export function ViewerPage() {
  const [imageUrl,  setImageUrl]  = useState('')
  const [error,     setError]     = useState('')
  const [loading,   setLoading]   = useState(true)
  const [viewerType, setViewerType] = useState<ViewerType | null>(null)
  const [title,     setTitle]     = useState('360度写真')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const type     = (params.get('type') ?? 'photosphere') as ViewerType
    const fileId   = params.get('fileId') ?? undefined
    const rawUrl   = params.get('url') ? decodeURIComponent(params.get('url')!) : undefined
    const rawTitle = params.get('title') ? decodeURIComponent(params.get('title')!) : '360度写真'
    const provider = params.get('storageProvider') ?? 'google-drive'

    setViewerType(type)
    setTitle(rawTitle)

    if (type === 'image') {
      // 通常画像: リダイレクト
      const target = fileId
        ? (provider === 'box'
            ? `https://app.box.com/file/${fileId}`
            : `https://drive.google.com/file/d/${fileId}/view`)
        : rawUrl ?? ''
      if (target) window.location.href = target
      else { setError('画像URLが指定されていません。'); setLoading(false) }
      return
    }

    if (type !== 'photosphere') {
      setError(`ビューワー種別 "${type}" は現在未対応です。`)
      setLoading(false)
      return
    }

    // 360度写真: URLを解決してPSVに渡す
    resolve360ImageUrl(fileId, rawUrl, provider)
      .then(resolved => {
        logViewerDebug({
          fileId, storageProvider: provider,
          resolvedImageUrl: resolved.url,
          viewerType: type,
          method: resolved.method,
        })
        setImageUrl(resolved.url)
        setLoading(false)
      })
      .catch(err => {
        console.error('[PhotoLinkMap ViewerPage] URL resolution failed:', err)
        setError(err instanceof Error ? err.message : '画像URLの解決に失敗しました')
        setLoading(false)
      })
  }, [])

  if (!loading && viewerType === 'photosphere' && imageUrl) {
    return (
      <Viewer360Modal
        imageUrl={imageUrl}
        title={title}
        onClose={() => {
          if (window.history.length > 1) window.history.back()
          else window.close()
        }}
      />
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 text-center">
        <div className="text-4xl mb-4">
          {error ? '⚠️' : loading ? '⏳' : viewerType ? (VIEWER_LABELS[viewerType] ?? '🔍') : '🔍'}
        </div>
        <div className="text-lg font-bold text-gray-800 mb-2">
          {error ? '読み込みエラー' : loading ? '読み込み中...' : `PhotoLinkMap ${viewerType ? VIEWER_LABELS[viewerType] : 'Viewer'}`}
        </div>
        {error && (
          <>
            <div className="text-sm text-gray-700 mb-4 whitespace-pre-line">{error}</div>
            <div className="text-xs text-gray-400 mb-4 text-left bg-gray-50 rounded p-2">
              <b>確認事項:</b><br />
              • Driveの共有設定: 「リンクを知っている全員が閲覧可能」<br />
              • BoxファイルのShared Linkが有効であること<br />
              • PhotoLinkMapがNetlifyにデプロイされていること
            </div>
          </>
        )}
        {loading && (
          <div className="text-sm text-gray-500 animate-pulse">360度画像URLを解決中...</div>
        )}
        <button onClick={() => window.close()}
          className="mt-4 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
          閉じる
        </button>
      </div>
    </div>
  )
}
