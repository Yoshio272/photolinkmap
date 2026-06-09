import { useState } from 'react'
import type { RefObject } from 'react'
import type { Pin, CalibState, ExportConfig } from '../../types'
import type { BackgroundSource } from '../../services/background'
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from 'pdf-lib'
import { calcArrowPDF, NO_ARROW } from '../../features/arrow'
import { getPinType } from '../../types'
import { getPinPdfLinkUrl } from '../../features/viewer/viewerTypes'
import type { StorageConfig } from '../../services/storage'
// arrow utilities used below

interface Props {
  pins: Pin[]; pdfLoaded: boolean
  bgSource: BackgroundSource | null
  canvasRef: RefObject<HTMLCanvasElement | null>
  canvasW: number; canvasH: number
  pageW: number; pageH: number   // Image原寸サイズ
  calib: CalibState
  exportConfig: ExportConfig
  setExportConfig: (c: ExportConfig) => void
  storageConfig?: StorageConfig
  projectName: string
  setStatusMsg: (m: string) => void
}

function hex2rgb(h: string) {
  return rgb(parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255)
}

export function ExportTab({ pins, pdfLoaded, bgSource, canvasRef, canvasW, canvasH, pageW, pageH, exportConfig, setExportConfig, storageConfig, projectName, setStatusMsg }: Props) {
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [exporting, setExporting] = useState(false)

  const linked = pins.filter(p => p.link).length

  function prog(p: number, m: string) { setProgress(p); setProgressMsg(m) }

  async function doExport() {
    if (!pdfLoaded) { alert('図面を読み込んでください'); return }
    if (!pins.length) { alert('ピンがありません'); return }
    const canvas = canvasRef.current; if (!canvas) return
    setExporting(true); setProgress(0)
    try {
      prog(10, 'PDF解析中...')
      let doc: PDFDocument

      if (bgSource?.type === 'pdf') {
        doc = await PDFDocument.load(bgSource.data as Uint8Array)
      } else {
        doc = await PDFDocument.create()
        const pg = doc.addPage([canvas.width, canvas.height])
        if (bgSource?.type === 'image') {
          const isPng = (bgSource.data as string).startsWith('data:image/png')
          const ib = await (await fetch(bgSource.data as string)).arrayBuffer()
          const img = isPng ? await doc.embedPng(ib) : await doc.embedJpg(ib)
          pg.drawImage(img, { x: 0, y: 0, width: canvas.width, height: canvas.height })
        } else {
          const ib = await (await fetch(canvas.toDataURL('image/jpeg', 0.92))).arrayBuffer()
          pg.drawImage(await doc.embedJpg(ib), { x: 0, y: 0, width: canvas.width, height: canvas.height })
        }
      }

      prog(25, 'ページ取得中...')
      const page = doc.getPages()[0]
      const { width: pW, height: pH } = page.getSize()
      // Image座標（原寸）→ PDF座標への変換スケール
      // pageW/pageH は原寸サイズ（ズーム不変）を使用
      const effectivePageW = pageW > 0 ? pageW : canvasW
      const effectivePageH = pageH > 0 ? pageH : canvasH
      const sx = pW / effectivePageW
      const sy = pH / effectivePageH
      console.log('[PhotoLinkMap PDF Export] page:', pW, pH, 'imageSize:', effectivePageW, effectivePageH, 'scale:', sx.toFixed(4), sy.toFixed(4))
      const font = await doc.embedFont(StandardFonts.HelveticaBold)
      const white = rgb(1, 1, 1)

      // 注記（ASCII only）
      const safeNote = exportConfig.noteText.replace(/[^\x00-\x7E]/g, '').trim()
      if (safeNote) page.drawText(safeNote, { x: 10, y: 10, size: 8, font, color: rgb(.3,.3,.3) })
      const now = new Date()
      page.drawText(`Output:${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`,
        { x: pW - 80, y: 10, size: 6.5, font, color: rgb(.5,.5,.5) })

      prog(35, `${pins.length}件のピンを描画中...`)

      for (let i = 0; i < pins.length; i++) {
        const pin = pins[i]
        prog(35 + Math.round((i+1)/pins.length * 55), `ピン ${i+1}/${pins.length}...`)
        // Image座標 → PDF座標（Y軸反転）
        const px = pin.px * sx, py = pH - pin.py * sy
        console.log(`[PDF pin ${i+1}] image:(${pin.px.toFixed(1)},${pin.py.toFixed(1)}) → pdf:(${px.toFixed(1)},${py.toFixed(1)})`)
        const r = (pin.r || 10) * sx, al = (pin.al || 30) * sx
        const clr = hex2rgb(pin.color || '#1565C0')
        const hasArrow = pin.deg !== NO_ARROW && al > 2

        if (hasArrow) {
          const arrow = calcArrowPDF(px, py, r, al, pin.deg)
          page.drawLine({ start: { x: arrow.tx, y: arrow.ty }, end: { x: arrow.ex, y: arrow.ey }, thickness: 1.5, color: clr })
          const head = arrow.calcHead(8, 4)
          page.drawLine({ start: { x: arrow.ex, y: arrow.ey }, end: { x: head.l.x, y: head.l.y }, thickness: 1.5, color: clr })
          page.drawLine({ start: { x: arrow.ex, y: arrow.ey }, end: { x: head.r.x, y: head.r.y }, thickness: 1.5, color: clr })
        }

        page.drawCircle({ x: px, y: py, size: r + 2, color: white, opacity: 0.88 })
        page.drawCircle({ x: px, y: py, size: r, color: clr })
        // ピン種別テキスト（小さなラベル）
        const pinType = getPinType(pin)
        if (pinType === '360' && r >= 6) {
          // 360マーク
          page.drawText('360', {
            x: px - font.widthOfTextAtSize('360', r * 0.55) / 2,
            y: py - r * 0.3,
            size: r * 0.55,
            font,
            color: white,
            opacity: 0.9,
          })
        }

        // ViewerProvider経由でリンクを生成
        // 360度写真 → PhotoLinkMap Viewerへのリンク
        // 通常写真  → Google Driveリンク
        const pinTypeVal = getPinType(pin)
        const viewerType = pinTypeVal === '360' ? 'photosphere' as const : 'image' as const
        const driveFileId = pin.media?.driveFileId
        const mediaUrl    = pin.media?.url || pin.link
        const storageProvider = storageConfig?.provider ?? 'google-drive'
        let linkUrl = getPinPdfLinkUrl(viewerType, driveFileId, mediaUrl, pin.name, pin.lat, pin.lng, storageProvider)
        if (!linkUrl && exportConfig.noLinkAction === 'map') linkUrl = `https://www.google.com/maps?q=${pin.lat},${pin.lng}`
        if (linkUrl) {
          const aw2 = (r + 4) * 2, ah2 = (r + 4) * 2, ax2 = px - r - 4, ay2 = py - r - 4
          const annot = doc.context.obj({
            Type: 'Annot', Subtype: 'Link', Rect: [ax2, ay2, ax2 + aw2, ay2 + ah2],
            Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of(linkUrl) },
          })
          const ref = doc.context.register(annot)
          const annots = page.node.get(PDFName.of('Annots'))
          if (annots && 'push' in annots) (annots as { push: (r: typeof ref) => void }).push(ref)
          else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]))
        }
      }

      prog(95, '保存中...')
      const bytes = await doc.save()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }))
      a.download = exportConfig.fileName || 'survey.pdf'
      a.click(); URL.revokeObjectURL(a.href)
      prog(100, `✓ 完了: ${pins.length}件 / リンク付き${linked}件`)
      setStatusMsg(`✓ STEP5 PDF出力完了: ${exportConfig.fileName}`)
    } catch (e: unknown) {
      prog(0, '❌ ' + (e instanceof Error ? e.message : '出力エラー'))
    } finally { setExporting(false) }
  }

  return (
    <div className="overflow-y-auto flex-1 flex flex-col gap-0">
      <div className="section">
        <h4>STEP5 PDF出力</h4>
        <div className={`info-box ${!pdfLoaded ? 'info-warn' : !pins.length ? 'info-warn' : 'info-green'}`}>
          {!pdfLoaded ? '図面を読み込んでください' : !pins.length ? 'ピンがありません'
            : `✓ ${pins.length}件のピン | 🔗リンク付き: ${linked}件`}
        </div>
        <div className="info-warn text-xs">
          <b>📌 リンクを有効にするには</b><br />
          出力PDFを <b>ChromeまたはEdgeにドラッグ</b> して開いてください。<br />
          <span className="opacity-80">Adobe Readerはデフォルトでリンクをブロックします。</span>
        </div>
      </div>

      <div className="section">
        <h4>ハイパーリンク設定</h4>
        <div className="label">リンクなしピンの扱い</div>
        <select className="input" value={exportConfig.noLinkAction}
          onChange={e => setExportConfig({ ...exportConfig, noLinkAction: e.target.value as 'skip' | 'map' })}>
          <option value="skip">リンクなし（クリック無効）</option>
          <option value="map">Google Maps座標リンクを自動付与</option>
        </select>
      </div>

      <div className="section">
        <h4>ファイル設定</h4>
        <div className="label">出力ファイル名</div>
        <input className="input mb-2" value={exportConfig.fileName}
          onChange={e => setExportConfig({ ...exportConfig, fileName: e.target.value })}
          onFocus={() => { if (!exportConfig.fileName) setExportConfig({ ...exportConfig, fileName: `${projectName.replace(/[^a-zA-Z0-9_\-]/g, '_')}.pdf` }) }} />
        <div className="label">注記（PDF左下・英数字のみ）</div>
        <input className="input" placeholder="Site Survey 2026-06"
          value={exportConfig.noteText} onChange={e => setExportConfig({ ...exportConfig, noteText: e.target.value })} />
      </div>

      {progressMsg && (
        <div className="section">
          <div className="h-1.5 bg-gray-200 rounded overflow-hidden mb-1">
            <div className="h-full bg-green-500 rounded transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-xs text-gray-500">{progressMsg}</div>
        </div>
      )}

      <div className="section">
        <button
          className="w-full py-3 text-sm font-bold text-white rounded-lg flex items-center justify-center gap-2 transition-colors"
          style={{ background: exporting || !pdfLoaded || !pins.length ? '#aadecb' : '#1D9E75', cursor: exporting ? 'not-allowed' : 'pointer' }}
          onClick={doExport} disabled={exporting || !pdfLoaded || !pins.length}>
          📤 ハイパーリンク付きPDFを出力
        </button>
      </div>
    </div>
  )
}
