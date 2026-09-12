import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, MessageCircle, Wrench } from 'lucide-react'
import type { AgentDescriptor } from '../../shared/contracts'
import type { ConversationItem, ConversationTurn } from '../../shared/conversation'
import { receivedMessageDisplay } from '../../shared/conversation'
import './messages.css'

const statuses: Record<string, string> = { inProgress: '実行中', completed: '完了', failed: '失敗', interrupted: '中断', declined: '拒否' }
const itemLabels: Record<string, string> = { reasoning: 'Codex reasoning', plan: '計画', contextCompaction: '会話の圧縮', commandExecution: 'コマンド実行', fileChange: 'ファイル変更', functionCallOutput: 'ツール結果' }

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content, null, 2)
  return content.map((part: unknown) => {
    if (typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string') return part.text
    return JSON.stringify(part, null, 2)
  }).join('\n')
}

function MessageItem({ item, agent, turnStatus }: { item: ConversationItem; agent: AgentDescriptor; turnStatus: string }) {
  if (item.type === 'userMessage' || item.type === 'agentMessage') {
    const incoming = item.type === 'userMessage'
    const text = incoming ? contentText(item.content) : String(item.text)
    const received = incoming ? receivedMessageDisplay(text) : null
    const thought = !incoming && agent.role === 'npc'
    const heading = thought ? /^\s*【(心の声|独り言)】\s*/.exec(text) : null
    return <div className={`message-row ${incoming ? 'input' : 'npc'}`}>
      {!incoming && <span className="avatar" style={{ '--agent-color': agent.color } as React.CSSProperties}>{agent.name.slice(-1)}</span>}
      <div className="message-body"><small>{incoming ? (received ? received.label : '入力・受信') : agent.name}{thought && ` · ${heading ? heading[1] : 'NPCの出力'}`}{item.phase === 'commentary' && ' · 途中経過'}</small><div className={`message-bubble${thought ? ' thought-bubble' : ''}`}>{received ? received.text : heading ? text.slice(heading[0].length) : text}</div>{thought && <small className="thought-visibility">ユーザーにのみ表示</small>}</div>
    </div>
  }
  const tool = item.type === 'dynamicToolCall' || item.type === 'mcpToolCall'
  const status = typeof item.status === 'string' ? item.status : null
  const failed = item.success === false || status === 'failed'
  const stopped = status === 'inProgress' && turnStatus !== 'inProgress'
  const label = failed ? '失敗' : stopped ? '未完了' : status ? (statuses[status] ?? status) : null
  return <details className={`message-tool ${failed ? 'failed' : ''}`}>
    <summary><Wrench size={13} /><strong>{tool ? String(item.tool) : (itemLabels[item.type] ?? item.type)}</strong>{label && <span>{label}</span>}</summary>
    {tool ? <><div className="tool-section"><small>引数</small><pre>{JSON.stringify(item.arguments, null, 2)}</pre></div><div className="tool-section"><small>結果</small><pre>{item.type === 'dynamicToolCall' ? (item.contentItems === null ? '結果はまだありません' : contentText(item.contentItems)) : JSON.stringify({ result: item.result, error: item.error }, null, 2)}</pre></div></> : <pre>{JSON.stringify(item, null, 2)}</pre>}
  </details>
}

export function MessageView({ agent, connected }: { agent: AgentDescriptor; connected: boolean }) {
  const [turns, setTurns] = useState<ConversationTurn[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const [following, setFollowing] = useState(true)
  const scroll = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const value = await window.persona.conversation(agent.sessionId)
        if (cancelled) return
        setTurns(value); setError(null)
        timer = setTimeout(() => void read(), 1500)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
    void read()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [agent.sessionId, connected, generation])
  useLayoutEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [turns])
  const latest = () => {
    follow.current = true; setFollowing(true)
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }
  return <div className="message-view" aria-label={`${agent.name}のメッセージ`}>
    <div className="message-info"><MessageCircle size={13} /> 会話とツール使用<span>{connected && !error ? '自動更新' : '更新停止'}</span></div>
    {!connected && <p className="message-notice">履歴の取得にはCodexへの接続が必要です。</p>}
    {error && <div className="message-notice" role="alert"><p>履歴を取得できませんでした。{turns && '表示中の履歴は最新ではありません。'}<br />{error}</p><button className="button compact" disabled={!connected} onClick={() => setGeneration(value => value + 1)}>再読み込み</button></div>}
    <div className="message-scroll" ref={scroll} onScroll={() => {
      const element = scroll.current!
      follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
      setFollowing(follow.current)
    }}>
      {turns === null && connected && !error && <p className="message-empty">履歴を読み込んでいます…</p>}
      {turns?.length === 0 && <div className="message-empty"><MessageCircle size={28} /><p>まだメッセージはありません</p><small>会話が始まると、ここに表示されます。</small></div>}
      {turns?.map((turn, index) => <div className="message-turn" key={turn.id}>
        <div className="message-divider"><span>{turn.startedAt != null ? new Date(turn.startedAt * 1000).toLocaleString('ja-JP') : `会話 ${index + 1}`} · {statuses[turn.status] ?? turn.status}</span></div>
        {turn.items.map(item => <MessageItem key={item.id} item={item} agent={agent} turnStatus={turn.status} />)}
        {turn.error && <p className="message-notice" role="alert">{turn.error.message}</p>}
      </div>)}
    </div>
    {!following && <button className="message-latest" onClick={latest}><ArrowDown size={13} />最新へ</button>}
    <div className="message-footer">メッセージの入力はCodexビューから</div>
  </div>
}
