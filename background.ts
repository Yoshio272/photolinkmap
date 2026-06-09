import { useState } from 'react'
import type { ProjectMeta } from '../features/project'
import { deleteProject, renameProject, deleteAllProjects, getStorageInfo } from '../features/project'

interface Props {
  metas: ProjectMeta[]
  onOpen: (name: string) => void
  onRefresh: () => void
  onClose: () => void
}

export function ProjectManager({ metas, onOpen, onRefresh, onClose }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const info = getStorageInfo()
  const usedPct = Math.min(100, Math.round(info.usedKB / info.totalKB * 100))

  function handleDelete(name: string) {
    if (!confirm(`「${name}」を削除しますか？\nこの操作は取り消せません。`)) return
    deleteProject(name)
    onRefresh()
  }

  function handleDeleteAll() {
    if (!confirm(`全プロジェクト（${metas.length}件）を削除しますか？\nこの操作は取り消せません。`)) return
    deleteAllProjects()
    onRefresh()
  }

  function handleRename(oldName: string) {
    if (!newName.trim()) { alert('名前を入力してください'); return }
    if (newName === oldName) { setRenaming(null); return }
    const ok = renameProject(oldName, newName.trim())
    if (!ok) { alert('その名前はすでに使われています'); return }
    setRenaming(null)
    onRefresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-bold text-gray-800">プロジェクト管理</h2>
            <p className="text-xs text-gray-500">{info.projectCount}件保存 / 使用容量 {info.usedKB}KB / {info.totalKB}KB</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        {/* 容量バー */}
        <div className="px-5 pt-3">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${usedPct}%`, background: usedPct > 80 ? '#E53935' : '#1565C0' }} />
          </div>
          <p className="text-xs text-gray-400 mt-0.5 text-right">{usedPct}% 使用中</p>
        </div>

        {/* プロジェクト一覧 */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {metas.length === 0 ? (
            <div className="text-center text-gray-400 py-12 text-sm">保存済みプロジェクトはありません</div>
          ) : metas.map(m => (
            <div key={m.name} className="border border-gray-100 rounded-xl p-3 mb-2 hover:border-gray-200 transition-colors">
              {renaming === m.name ? (
                /* リネーム入力 */
                <div className="flex gap-2 items-center">
                  <input
                    autoFocus
                    className="flex-1 px-2 py-1 text-sm border border-[#1565C0] rounded-lg focus:outline-none"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(m.name); if (e.key === 'Escape') setRenaming(null) }}
                  />
                  <button className="px-3 py-1 text-xs bg-[#1565C0] text-white rounded-lg" onClick={() => handleRename(m.name)}>確定</button>
                  <button className="px-3 py-1 text-xs border border-gray-300 rounded-lg" onClick={() => setRenaming(null)}>取消</button>
                </div>
              ) : (
                <>
                  {/* プロジェクト情報 */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-gray-800 truncate">{m.name}</div>
                      <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>更新: {new Date(m.updatedAt).toLocaleString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
                        <span>📍 {m.pinCount}件</span>
                        <span>📷 {m.photoCount}件</span>
                        {m.bgFileName && <span className="truncate max-w-[120px]">📄 {m.bgFileName}</span>}
                        <span className="text-gray-300">~{m.sizeEstimateKB}KB</span>
                      </div>
                    </div>
                    {/* アクション */}
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        className="px-2.5 py-1 text-xs bg-[#1565C0] text-white rounded-lg hover:bg-[#0D47A1] font-semibold"
                        onClick={() => { onOpen(m.name); onClose() }}>
                        開く
                      </button>
                      <button
                        className="px-2.5 py-1 text-xs border border-gray-300 rounded-lg hover:bg-gray-50"
                        onClick={() => { setRenaming(m.name); setNewName(m.name) }}>
                        名前変更
                      </button>
                      <button
                        className="px-2.5 py-1 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50"
                        onClick={() => handleDelete(m.name)}>
                        削除
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* フッター */}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-between items-center">
          {metas.length > 0 && (
            <button
              className="text-xs text-red-400 hover:text-red-600"
              onClick={handleDeleteAll}>
              全プロジェクト削除
            </button>
          )}
          <button className="ml-auto px-4 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
