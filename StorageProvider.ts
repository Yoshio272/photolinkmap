/**
 * 360度写真ビューワー モーダル - @photo-sphere-viewer/core v5
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Viewer } from '@photo-sphere-viewer/core'
import '@photo-sphere-viewer/core/index.css'

interface Props {
  imageUrl: string
  title: string
  onClose: () => void
}

export function Viewer360Modal({ imageUrl, title, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef    = useRef<Viewer | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error,   setError]     = useState<string | null>(null)
  const [isFull,  setIsFull]    = useState(false)

  useEffect(() => {
    if (!containerRef.current) return
    let viewer: Viewer
    try {
      viewer = new Viewer({
        container: containerRef.current,
        panorama: imageUrl,
        caption: title,
        touchmoveTwoFingers: false,
        mousewheelCtrlKey: false,
        defaultZoomLvl: 50,
        navbar: false,
      })
      viewer.addEventListener('ready', () => setLoading(false))
      viewerRef.current = viewer
    } catch(e) {
      setError('360度ビューワーの初期化に失敗しました: ' + String(e))
      setLoading(false)
    }
    // タイムアウトによるエラー検知
    const timeout = setTimeout(() => {
      if (loading) setError('360度画像の読み込みに失敗しました。\nDriveの共有設定を「リンクを知っている全員が閲覧可能」にしてください。')
    }, 15000)
    return () => {
      clearTimeout(timeout)
      try { viewerRef.current?.destroy() } catch { /* ignore */ }
      viewerRef.current = null
    }
  }, [imageUrl, title])

  const toggleFull = useCallback(() => {
    const el = document.getElementById('psv-modal')
    if (!el) return
    if (!document.fullscreenElement) el.requestFullscreen().then(() => setIsFull(true)).catch(() => {})
    else document.exitFullscreen().then(() => setIsFull(false)).catch(() => {})
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'f') toggleFull() }
    const onFull = () => setIsFull(!!document.fullscreenElement)
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFull)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFull) }
  }, [onClose, toggleFull])

  // suppress loading warning
  void loading

  return (
    <div id="psv-modal" className="fixed inset-0 z-50 flex flex-col bg-black" style={{ touchAction: 'none' }}>
      <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between px-4 py-2 bg-black/60">
        <div className="flex items-center gap-2">
          <span className="text-lg">🌐</span>
          <span className="text-white text-sm font-semibold truncate max-w-[200px]">{title}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={toggleFull}
            className="text-white/70 hover:text-white px-2 py-1 text-xs border border-white/20 hover:border-white/50 rounded transition-colors">
            {isFull ? '⊡ 解除' : '⊞ 全画面'}
          </button>
          <button onClick={onClose}
            className="text-white/70 hover:text-white w-8 h-8 flex items-center justify-center border border-white/20 hover:border-white/50 rounded-full text-lg transition-colors"
            title="Esc">✕</button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 w-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
          <div className="bg-white rounded-xl p-6 max-w-sm mx-4 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <div className="text-sm text-gray-700 whitespace-pre-line mb-3">{error}</div>
            <button onClick={onClose} className="px-4 py-2 bg-[#1565C0] text-white rounded-lg text-sm font-semibold">閉じる</button>
          </div>
        </div>
      )}
      {!error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
          {['🖱️ ドラッグで回転', '🔍 ホイールでズーム', '📱 スワイプ対応'].map(h => (
            <div key={h} className="bg-black/50 rounded-full px-3 py-1 text-white/70 text-xs">{h}</div>
          ))}
        </div>
      )}
    </div>
  )
}
