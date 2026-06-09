import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

const CMAP_URL = new URL('pdfjs-dist/cmaps/', import.meta.url).toString()

export type SourceType = 'pdf' | 'image'

export interface SourceInfo {
  pdfBytes: Uint8Array | null   // PDF only
  imageDataUrl: string | null   // image only
  sourceType: SourceType
  pageWidth: number             // original pt or px
  pageHeight: number
}

// ===== fit scale計算（中央に収める）=====
export function calcFitScale(
  pageW: number,
  pageH: number,
  areaW: number,
  areaH: number,
  padding = 32,
  maxScale = 3
): number {
  const availW = Math.max(areaW - padding * 2, 100)
  const availH = Math.max(areaH - padding * 2, 100)
  return Math.min(availW / pageW, availH / pageH, maxScale)
}

// ===== PDF読み込み =====
export async function loadPdfFile(
  file: File,
  canvas: HTMLCanvasElement,
  areaW: number,
  areaH: number
): Promise<SourceInfo> {
  const ab = await file.arrayBuffer()
  const bytes = new Uint8Array(ab)
  const doc = await pdfjsLib.getDocument({
    data: ab.slice(0),
    cMapUrl: CMAP_URL,
    cMapPacked: true,
  }).promise
  const page = await doc.getPage(1)
  const orig = page.getViewport({ scale: 1 })
  const fitScale = calcFitScale(orig.width, orig.height, areaW, areaH)
  await renderPdfToCanvas(page, canvas, fitScale)
  return {
    pdfBytes: bytes,
    imageDataUrl: null,
    sourceType: 'pdf',
    pageWidth: orig.width,
    pageHeight: orig.height,
  }
}

// ===== 画像ファイル読み込み（JPEG/PNG）=====
export async function loadImageFile(
  file: File,
  canvas: HTMLCanvasElement,
  areaW: number,
  areaH: number
): Promise<SourceInfo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const fitScale = calcFitScale(img.naturalWidth, img.naturalHeight, areaW, areaH)
      const w = Math.round(img.naturalWidth * fitScale)
      const h = Math.round(img.naturalHeight * fitScale)
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      // DataURLとして保持（PDF出力・再描画用）
      resolve({
        pdfBytes: null,
        imageDataUrl: canvas.toDataURL('image/png'),
        sourceType: 'image',
        pageWidth: img.naturalWidth,
        pageHeight: img.naturalHeight,
      })
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像の読み込みに失敗しました')) }
    img.src = url
  })
}

// ===== PDF再レンダリング（ズーム・fitで使用）=====
export async function reRenderPdf(
  pdfBytes: Uint8Array,
  canvas: HTMLCanvasElement,
  scale: number
): Promise<{ canvasW: number; canvasH: number }> {
  const doc = await pdfjsLib.getDocument({
    data: pdfBytes.slice(0),
    cMapUrl: CMAP_URL,
    cMapPacked: true,
  }).promise
  const page = await doc.getPage(1)
  await renderPdfToCanvas(page, canvas, scale)
  return { canvasW: canvas.width, canvasH: canvas.height }
}

// ===== 画像再レンダリング（ズーム・fitで使用）=====
export function reRenderImage(
  imageDataUrl: string,
  canvas: HTMLCanvasElement,
  pageW: number,
  pageH: number,
  scale: number
): Promise<{ canvasW: number; canvasH: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const w = Math.round(pageW * scale)
      const h = Math.round(pageH * scale)
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      resolve({ canvasW: w, canvasH: h })
    }
    img.onerror = () => reject(new Error('画像再描画失敗'))
    img.src = imageDataUrl
  })
}

// ===== PDF→Canvas描画（内部）=====
async function renderPdfToCanvas(
  page: pdfjsLib.PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number
) {
  const vp = page.getViewport({ scale })
  canvas.width = Math.round(vp.width)
  canvas.height = Math.round(vp.height)
  const ctx = canvas.getContext('2d')!
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise
}

// ===== ファイル種別判定 =====
export function getFileSourceType(file: File): SourceType | null {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return 'pdf'
  if (['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) return 'image'
  return null
}
