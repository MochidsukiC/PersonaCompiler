import { useState } from 'react'
import { ChevronDown, ChevronRight, FileCode2, FileImage, FileText, Folder, FolderOpen, Search, Users } from 'lucide-react'
import type { AgentDescriptor, FileEntry } from '../../shared/contracts'
import { agentStatusLabels, roleLabels } from './labels'
import './explorer.css'

function FileTree({ files, selected, onSelect, level = 0 }: { files: FileEntry[]; selected: string | null; onSelect: (path: string) => void; level?: number }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  return <>{files.map(file => {
    const isDirectory = file.kind === 'directory'
    const open = !collapsed.has(file.path)
    const Icon = isDirectory ? (open ? FolderOpen : Folder) : /\.(png|jpe?g|webp)$/i.test(file.name) ? FileImage : file.name.endsWith('.json') ? FileCode2 : FileText
    return <div key={file.path}>
      <button className={`file-row ${selected === file.path ? 'selected' : ''}`} style={{ paddingLeft: 14 + level * 13 }} title={file.path} aria-expanded={isDirectory ? open : undefined} onClick={() => {
        if (isDirectory) setCollapsed(previous => { const next = new Set(previous); if (open) next.add(file.path); else next.delete(file.path); return next })
        else onSelect(file.path)
      }}>{isDirectory ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : <span className="tree-spacer" />}<Icon size={14} /><span>{file.name}</span></button>
      {isDirectory && open && file.children && <FileTree files={file.children} selected={selected} onSelect={onSelect} level={level + 1} />}
    </div>
  })}</>
}

export function Explorer({ files, agents, selected, activeAgent, onSelect, onAgent, onReveal }: {
  files: FileEntry[]; agents: AgentDescriptor[]; selected: string | null; activeAgent: string | null;
  onSelect: (path: string) => void; onAgent: (id: string) => void; onReveal: () => void
}) {
  const [filter, setFilter] = useState('')
  return <aside className="explorer">
    <div className="pane-heading"><span>EXPLORER</span><button className="icon-button" onClick={onReveal} aria-label="プロジェクトフォルダーを開く" title="Windows Explorerで開く"><FolderOpen size={15} /></button></div>
    <div className="explorer-project"><span className="project-icon"><Folder size={16} /></span><div><strong>木漏れ日の町</strong><small>LOCAL WORKSPACE</small></div><span className="local-dot" /></div>
    <div className="section-label"><ChevronDown size={12} /> プロジェクトファイル <span>DISK</span></div>
    <div className="file-tree" aria-label="ファイル一覧"><FileTree files={files} selected={selected} onSelect={onSelect} /></div>
    <div className="agent-browser">
      <div className="section-label"><Users size={13} /> エージェント <span>{agents.length}</span></div>
      <label className="agent-search"><Search size={13} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="名前で検索…" aria-label="エージェントを検索" /></label>
      <div className="agent-list">{agents.filter(a => `${a.name} ${a.id}`.toLowerCase().includes(filter.toLowerCase())).map(agent => <button className={`agent-row ${activeAgent === agent.id ? 'selected' : ''}`} key={agent.id} onClick={() => onAgent(agent.id)} aria-label={`${agent.name}の端末を開く`} aria-description={`状態: ${agentStatusLabels[agent.status]}`} title={`${agent.name} · ${agentStatusLabels[agent.status]}`}>
        <span className="mini-avatar" style={{ color: agent.color, borderColor: `${agent.color}55` }}>{agent.role === 'parent' ? 'P' : agent.role === 'observer' ? 'O' : agent.name.slice(-1)}</span>
        <span className="agent-name"><span>{agent.name}</span><small>{roleLabels[agent.role]}</small></span><span className={`agent-status ${agent.status}`}>{agentStatusLabels[agent.status]}</span>
      </button>)}</div>
    </div>
    <div className="disk-note"><span className="status-dot" /> ファイルの変更を監視中</div>
  </aside>
}
