import { useEffect, useState } from 'react'
import type { PersistenceStatus } from '../../core/persistence'

export function PersistencePanel({ status, onError }: { status: PersistenceStatus; onError(error: unknown): void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const labels = { saved: '保存済み', pending: '未保存の変更あり', saving: '保存中', error: '保存エラー', readOnly: '閲覧専用' }
  return <div className="life-controls" data-testid="persistence-status" role="status">
    <span><strong>{labels[status.state]}</strong> · revision {status.savedRevision} / {status.revision} · 最終保存 {status.savedAt ? new Date(status.savedAt).toLocaleTimeString() : 'なし'}<br />
      未保存 {status.unsavedSince ? Math.max(0, Math.floor((now - Date.parse(status.unsavedSince)) / 1000)) : 0}秒 · 約{(status.unsavedBytes / 1024).toFixed(1)} KB
      {status.error && <span role="alert"> · {status.error}（メモリー上のデータを保持しています）</span>}
      {status.readOnlyReason && <span> · {status.readOnlyReason}</span>}</span>
    <button className="button compact" disabled={status.state === 'saving' || !!status.readOnlyReason} onClick={() => void window.persona.saveNow().catch(onError)}>今すぐ保存</button>
  </div>
}
