import { useRef, useState } from 'react'
import type { Pin, CalibState, AppMode } from '../../types'
import type { StorageConfig } from '../../services/storage'
import { getStorageProvider } from '../../services/storage'
import { readExifGPS } from '../../services/gps'
import { latLngToPx } from '../../features/calibration/transform'
import { PIN_TYPE_DEFAULT_COLORS } from '../../types'
import {
  photoReducer as _photoReducer,
  createPhotoEntry,
  STATUS_LABELS, STATUS_BADGE,
  type PhotoEntry, type PhotoAction,
} from '../../features/photos/photoStore'

// suppress unused import
void _photoReducer

interface Props {
  calib: CalibState
  pins: Pin[]
  setPins: (p: Pin[] | ((prev: Pin[]) => Pin[])) => void
  storageConfig: StorageConfig
  canvasW: number; canvasH: number
  setStatusMsg: (m: string) => void
  mode: AppMode
  onStartManualPlace: (photo: { name: string; url: string; is360: boolean }) => void
  // 集中管理された写真ストア
  photos: PhotoEntry[]
  dispatchPhotos: (action: PhotoAction) => void
}

export function PhotosTab({
  calib, pins, setPins, storageConfig, canvasW, canvasH,
  setStatusMsg, onStartManualPlace,
  photos, dispatchPhotos,
}: Props) {
  const [driveStatus, setDriveStatus]       = useState('')
  const [driveMatched, setDriveMatched]     = useState(0)
  const [driveUnmatched, setDriveUnmatched] = useState(0)
  const [bulkLinks, setBulkLinks]           = useState('')
  const [loadingState, setLoadingState]     = useState(false)
  const [progressState, setProgressState]   = useState(0)
  const fileRef   = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  async function handlePhotos(files: FileList | null) {
    if (!files?.length) return
    setLoadingState(true); setProgressState(0)
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'))
    const newEntries: PhotoEntry[] = []
    const newPins: Pin[] = []

    for (let i = 0; i < arr.length; i++) {
      const f = arr[i]
      const url = URL.createObjectURL(f)
      const gps = await readExifGPS(f)
      const is360 = /360|sphere|pano|panorama|equirect/i.test(f.name)
      setProgressState(Math.round((i + 1) / arr.length * 100))

      const entry = createPhotoEntry(f.name, url, !!gps, is360)

      if (gps && calib.ready) {
        const pos = latLngToPx(gps.lat, gps.lng, calib.points)
        if (pos && pos.x >= 0 && pos.x <= canvasW && pos.y >= 0 && pos.y <= canvasH) {
          const pinType = is360 ? '360' as const : 'photo' as const
          const pinId = 'p' + Date.now() + '_' + i
          const pin: Pin = {
            id: pinId, px: pos.x, py: pos.y, lat: gps.lat, lng: gps.lng,
            name: f.name.replace(/\.[^.]+$/, ''), memo: '', link: url,
            deg: 270, r: 10, al: 30,
            color: PIN_TYPE_DEFAULT_COLORS[pinType],
            src: 'gps', placedBy: 'gps',
            photoFileName: f.name,
            media: { type: pinType, url },
          }
          newPins.push(pin)
          entry.status = 'gps'
          entry.pinId = pinId
        }
      }
      newEntries.push(entry)
    }

    // 写真ストアに追加（既存は上書きしない）
    dispatchPhotos({ type: 'ADD_PHOTOS', photos: newEntries })
    // ピンを追加
    if (newPins.length > 0) {
      setPins(prev => [...prev, ...newPins])
    }

    setLoadingState(false)
    const placed = newEntries.filter(e => e.status === 'gps').length
    const unplaced = newEntries.filter(e => e.status === 'unplaced').length
    const msg = calib.ready
      ? `写真取込: ${newEntries.length}件（GPS配置:${placed}件 / 未配置:${unplaced}件）`
      : `写真取込: ${newEntries.length}件（基準点設定後に配置できます）`
    setStatusMsg(msg)
  }

  async function syncDrive() {
    const provider = getStorageProvider(storageConfig.provider)
    const validationError = provider.validateConfig(storageConfig)
    if (validationError) { alert(validationError); return }
    if (!pins.length) { alert('先に写真を取り込んでください'); return }
    const folderId = storageConfig.provider === 'google-drive'
      ? storageConfig.googleDrive.folderId
      : (storageConfig.box.folderId ?? '')
    setDriveStatus('📂 ストレージフォルダを取得中...')
    try {
      const result = await (provider as import('../../services/storage/GoogleDriveProvider').GoogleDriveProvider).listFiles(folderId, storageConfig)
      if (!result.success || !result.files?.length) { setDriveStatus('❌ ' + (result.error || '取得失敗')); return }
      const map: Record<string, string> = {}
      result.files?.forEach(f => { map[f.name.toLowerCase()] = f.viewUrl })
      let m = 0, u = 0
      setPins(prev => prev.map(pin => {
        const fn = (pin.photoFileName || pin.name || '').toLowerCase()
        const base = fn.replace(/\.[^.]+$/, '')
        const url = map[fn] ?? Object.entries(map).find(([k]) => k.replace(/\.[^.]+$/, '') === base)?.[1] ?? ''
        if (url) {
          m++
          // BoxファイルIDをdriveFileIdに保存（ViewerPage でfileId経由のプロキシを使うため）
          const matchedFile = result.files?.find(f => f.name.toLowerCase() === fn || f.name.toLowerCase().replace(/\.[^.]+$/, '') === base)
          const boxFileId = matchedFile?.fileId
          const updatedMedia = {
            ...(pin.media ?? { type: 'photo' as const }),
            url,
            ...(boxFileId && storageConfig.provider === 'box' ? { driveFileId: boxFileId } : {}),
          }
          return { ...pin, link: url, media: updatedMedia }
        }
        u++; return pin
      }))
      setDriveMatched(m); setDriveUnmatched(u)
      setDriveStatus(`✓ ${result.files?.length ?? 0}件取得 | マッチ:${m}件 / 未一致:${u}件`)
      setStatusMsg(`Drive連携完了: ${m}件にリンクを設定しました`)
    } catch (e: unknown) { setDriveStatus('❌ ' + (e instanceof Error ? e.message : '接続エラー')) }
  }

  function applyBulk() {
    const links = bulkLinks.trim().split('\n').map(l => l.trim()).filter(Boolean)
    if (!links.length) { alert('URLを入力してください'); return }
    let i = 0
    setPins(prev => prev.map(p => !p.link && i < links.length
      ? { ...p, link: links[i++], media: { ...(p.media ?? { type: 'photo' as const }), url: links[i-1] } }
      : p))
    setStatusMsg(`${i}件のリンクを割り当てました`)
    setBulkLinks('')
  }

  // pins変化をphotoストアに反映（移動・手動配置後）
  const syncedPhotos = photos.map(entry => {
    const pin = pins.find(p => p.photoFileName === entry.fileName || p.name === entry.displayName)
    if (!pin) return entry
    let status = entry.status
    if (pin.moved) status = 'moved'
    else if (pin.placedBy === 'manual' && entry.status === 'unplaced') status = 'manual'
    else if (pin.src === 'gps' && entry.status === 'unplaced') status = 'gps'
    return { ...entry, status, pinId: pin.id }
  })

  const visiblePhotos = syncedPhotos.filter(e => e.status !== 'deleted')
  const stats = {
    gps:      visiblePhotos.filter(e => e.status === 'gps').length,
    manual:   visiblePhotos.filter(e => e.status === 'manual').length,
    moved:    visiblePhotos.filter(e => e.status === 'moved').length,
    unplaced: visiblePhotos.filter(e => e.status === 'unplaced').length,
  }

  return (
    <div className="overflow-y-auto flex-1">
      <div className="section">
        <h4>STEP3 写真取込（GPS自動配置）</h4>
        <div className="info-blue mb-2 text-xs">
          GPS付き写真は図面上に自動配置。GPS無し写真は「手動配置」ボタンで手動配置できます。
        </div>
        <div className="flex gap-2 mb-2">
          <button className="btn flex-1 justify-center" onClick={() => folderRef.current?.click()}>📁 フォルダ</button>
          <button className="btn flex-1 justify-center" onClick={() => fileRef.current?.click()}>📷 写真選択</button>
        </div>
        <input ref={fileRef} id="toolbar-photo-input" type="file" accept="image/*" multiple className="hidden"
          onChange={e => handlePhotos(e.target.files)} />
        <input ref={folderRef} type="file" accept="image/*" multiple className="hidden"
          // @ts-ignore
          webkitdirectory="true"
          onChange={e => handlePhotos(e.target.files)} />

        {loadingState && (
          <div className="h-1.5 bg-gray-200 rounded overflow-hidden mb-2">
            <div className="h-full bg-[#1565C0] rounded transition-all" style={{ width: `${progressState}%` }} />
          </div>
        )}

        {/* 統計 */}
        {visiblePhotos.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {stats.gps     > 0 && <span className="badge badge-green text-xs">GPS:{stats.gps}</span>}
            {stats.manual  > 0 && <span className="badge badge-blue  text-xs">手動:{stats.manual}</span>}
            {stats.moved   > 0 && <span className="badge badge-warn  text-xs">移動:{stats.moved}</span>}
            {stats.unplaced > 0 && <span className="badge badge-gray text-xs">未配置:{stats.unplaced}</span>}
          </div>
        )}

        {/* 写真一覧（集中管理・永続） */}
        {visiblePhotos.length > 0 && (
          <div className="max-h-72 overflow-y-auto border border-gray-100 rounded">
            {visiblePhotos.map((entry, i) => (
              <div key={entry.fileName + i}
                className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-50 last:border-0 text-xs">
                <img src={entry.objectUrl} alt="" className="w-8 h-8 object-cover rounded flex-shrink-0"
                  onError={e => (e.currentTarget.style.display='none')} />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">
                    {entry.is360 ? '🌐 ' : '📷 '}{entry.displayName}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className={`badge ${STATUS_BADGE[entry.status]} text-xs`}>
                      {STATUS_LABELS[entry.status]}
                    </span>
                    {!entry.hasGps && entry.status === 'unplaced' && (
                      <span className="text-gray-400 text-xs">GPS無</span>
                    )}
                  </div>
                </div>
                {/* 手動配置ボタン（未配置のみ） */}
                {entry.status === 'unplaced' && calib.ready && (
                  <button
                    className="flex-shrink-0 px-2 py-1 text-xs bg-[#1565C0] text-white rounded-lg hover:bg-[#0D47A1] font-semibold whitespace-nowrap"
                    onClick={() => {
                      // ① モードを place-photo に切替
                      onStartManualPlace({
                        name: entry.displayName,
                        url: entry.objectUrl,
                        is360: entry.is360,
                      })
                      // ② PhotoEntryのstatusは変えない（まだ配置してないから）
                      // → MapCanvas.onPendingPhotoPlaced 後に SYNC_PINS で更新される
                    }}>
                    {entry.is360 ? '🌐 配置' : '📷 配置'}
                  </button>
                )}
                {entry.status !== 'unplaced' && (
                  <span className="text-gray-300 flex-shrink-0">✓</span>
                )}
              </div>
            ))}
          </div>
        )}

        {visiblePhotos.some(e => e.status === 'unplaced') && !calib.ready && (
          <div className="info-warn text-xs mt-2">⚠ 手動配置には基準点設定（STEP2）が必要です</div>
        )}
      </div>

      {/* Drive連携 */}
      <div className="section">
        <h4>Google Drive リンク自動連携</h4>
        <div className="info-blue mb-2 text-xs">ファイル名マッチングで各ピンにDrive写真リンクを設定します。</div>
        <div className={`badge mb-2 ${storageConfig.googleDrive.webAppUrl ? 'badge-green' : 'badge-warn'}`}>
          {storageConfig.googleDrive.webAppUrl ? '🔗 GAS接続済み' : '⚠ GAS未設定 → 設定タブへ'}
        </div>
        <button className="btn w-full justify-center mb-2 font-semibold"
          style={{ background: '#E0F5EC', color: '#0F6E56', borderColor: '#5DCAA5' }}
          onClick={syncDrive}>
          🔄 写真リンクを取得してピンに自動設定
        </button>
        {driveStatus && (
          <div className={`text-xs mb-1 ${driveStatus.startsWith('✓') ? 'text-green-600' : 'text-gray-500'}`}>
            {driveStatus}
          </div>
        )}
        {(driveMatched > 0 || driveUnmatched > 0) && (
          <div className="flex gap-2">
            <span className="badge badge-green">一致:{driveMatched}件</span>
            <span className="badge badge-gray">未一致:{driveUnmatched}件</span>
          </div>
        )}
      </div>

      {/* 一括リンク */}
      <div className="section">
        <h4>リンク一括貼り付け（手動）</h4>
        <textarea className="input font-mono text-xs resize-y mb-2" rows={4}
          placeholder={"https://drive.google.com/file/d/.../view\nhttps://..."}
          value={bulkLinks} onChange={e => setBulkLinks(e.target.value)} />
        <button className="btn w-full justify-center" onClick={applyBulk}>順番に割り当てる</button>
      </div>
    </div>
  )
}

