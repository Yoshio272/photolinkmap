export interface DriveFile {
  name: string
  url: string
  id: string
}

export interface DriveResult {
  success: boolean
  folderName?: string
  count?: number
  files?: DriveFile[]
  error?: string
}

export function fetchDriveFiles(gasUrl: string, folderId: string): Promise<DriveResult> {
  return new Promise((resolve, reject) => {
    const cbName = `cb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const script = document.createElement('script')
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('タイムアウト。GAS URLとデプロイ設定を確認してください。'))
    }, 20000)

    function cleanup() {
      clearTimeout(timer)
      delete (window as unknown as Record<string, unknown>)[cbName]
      script.parentNode?.removeChild(script)
    }

    ;(window as unknown as Record<string, (d: DriveResult) => void>)[cbName] = (data: DriveResult) => {
      cleanup()
      resolve(data)
    }

    script.src = `${gasUrl}?folderId=${encodeURIComponent(folderId)}&callback=${encodeURIComponent(cbName)}`
    script.onerror = () => {
      cleanup()
      reject(new Error('GAS接続失敗。URLとデプロイ設定（アクセス：全員）を確認してください。'))
    }
    document.head.appendChild(script)
  })
}

export function parseFolderIdFromUrl(url: string): string | null {
  const m = url.match(/folders\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}
