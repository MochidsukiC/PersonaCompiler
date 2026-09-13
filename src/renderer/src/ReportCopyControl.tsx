import { useEffect, useRef, useState } from 'react'
import './report-copy.css'

export function ReportCopyControl({ label, description, text, success, disabled = false }: { label: string; description: string; text: () => string; success: string; disabled?: boolean }) {
  const [copying, setCopying] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const copy = async () => {
    setCopying(true); setMessage(null); setError(null)
    try {
      await navigator.clipboard.writeText(text())
      if (active.current) setMessage(success)
    } catch (reason) { if (active.current) setError(`レポートをコピーできません: ${reason instanceof Error ? reason.message : String(reason)}`) }
    finally { if (active.current) setCopying(false) }
  }
  return <div className="report-copy-control">
    <button className="button compact" disabled={disabled || copying} onClick={() => void copy()}>{copying ? 'コピー中…' : label}</button>
    <small>{description}</small>
    {message && <p aria-live="polite">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
