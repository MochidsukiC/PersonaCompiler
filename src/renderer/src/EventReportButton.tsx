import { useEffect, useRef, useState } from 'react'
import { eventReportMarkdown, type EventReportInput } from '../../core/event-report'

export function EventReportButton({ input, disabled }: { input: EventReportInput; disabled: boolean }) {
  const [copying, setCopying] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const copy = async () => {
    setCopying(true); setMessage(null); setError(null)
    try {
      await navigator.clipboard.writeText(eventReportMarkdown(input, new Date().toISOString()))
      if (active.current) setMessage(`表示中の${input.events.length}件と検索条件をコピーしました。`)
    } catch (reason) { if (active.current) setError(`レポートをコピーできません: ${reason instanceof Error ? reason.message : String(reason)}`) }
    finally { if (active.current) setCopying(false) }
  }
  return <div className="event-report-control">
    <button className="button compact" disabled={disabled || copying} onClick={() => void copy()}>{copying ? 'コピー中…' : 'QAレポートをコピー'}</button>
    <small>表示中の出来事・検索条件・参照位置をMarkdownでコピーします。</small>
    {message && <p aria-live="polite">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
