import { memo, useMemo, useState } from 'react'
import { Background, Controls, Handle, Position, MarkerType, BaseEdge, type Node, type NodeProps, type Edge, type EdgeProps } from '@xyflow/react'
import { Home, Coffee, Trees, BookOpen, Hammer, Building2, ArrowUpRight, GitBranch, MapPin, X, FileText } from 'lucide-react'
import type { AgentDescriptor, RunState, RelationshipSnapshot } from '../../shared/contracts'
import { FacilityInterior } from './FacilityInterior'
import { SpeechBubble, useSpeechBubbles } from './SpeechBubble'
import { worldLayout, type SpeechBubble as Speech } from './world-presentation'
import { WorldGraph } from './WorldGraph'
import { MemoryEvidence } from './MemoryPanel'

type FacilityData = { name: string; kind: string; people: AgentDescriptor[]; speech: Speech[]; onAgent: (id: string) => void; onFacility?: () => void }
type FacilityNode = Node<FacilityData, 'facility'>
function Facility({ data }: NodeProps<FacilityNode>) {
  const icons = { home: Home, cafe: Coffee, park: Trees, library: BookOpen, workshop: Hammer }
  const builtIn = Object.hasOwn(icons, data.kind)
  const Icon = builtIn ? icons[data.kind as keyof typeof icons] : Building2
  return <div className={`facility ${builtIn ? data.kind : 'custom'}`}>
    <Handle type="source" position={Position.Bottom} /><Handle type="target" position={Position.Top} />
    <div className="facility-symbol"><Icon size={25} strokeWidth={1.4} /></div><strong>{data.name}</strong>
    {data.onFacility && <button className="facility-open nodrag nopan" aria-label={`${data.name}の内部を見る`} onClick={data.onFacility}>内部へ</button>}
    <div className="residents">{data.people.map(person => <button key={person.id} className="resident nodrag nopan" style={{ '--agent-color': person.color } as React.CSSProperties} title={person.name} aria-label={`地図から${person.name}の端末を開く`} onClick={event => { event.stopPropagation(); data.onAgent(person.id) }}>{person.name.slice(-1)}</button>)}</div>
    <div className="facility-speech nodrag nopan">{data.speech.map(speech => <SpeechBubble key={speech.sequence} speech={speech} name={data.people.find(p => p.id === speech.actorId)!.name} onSelect={() => data.onAgent(speech.actorId)} />)}</div>
  </div>
}
function Area({ data }: NodeProps<Node<{ name: string; color: string }>>) { return <div className="map-area" style={{ borderColor: `${data.color}35`, background: `${data.color}06` }}><span style={{ color: data.color }}>{data.name}</span></div> }
function Person({ data }: NodeProps<Node<{ agent: AgentDescriptor; onAgent: (id: string) => void }>>) {
  return <button className="relationship-person" onClick={() => data.onAgent(data.agent.id)} aria-label={`関係図から${data.agent.name}の端末を開く`}>
    <Handle type="target" id="left-in" position={Position.Left} /><Handle type="target" id="right-in" position={Position.Right} /><span className="avatar" style={{ '--agent-color': data.agent.color } as React.CSSProperties}>{data.agent.name.slice(-1)}</span><strong>{data.agent.name}</strong><small>住民 / {data.agent.id}</small><Handle type="source" id="left-out" position={Position.Left} /><Handle type="source" id="right-out" position={Position.Right} />
  </button>
}
const nodeTypes = { facility: Facility, area: Area, person: Person }
function RelationCurve({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, label, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius }: EdgeProps) {
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const length = Math.hypot(dx, dy)
  const bend = length === 0 ? 0 : 40 / length
  const cx = (sourceX + targetX) / 2 - dy * bend
  const cy = (sourceY + targetY) / 2 + dx * bend
  return <BaseEdge id={id} path={`M ${sourceX},${sourceY} Q ${cx},${cy} ${targetX},${targetY}`} markerEnd={markerEnd} style={style} label={label} labelX={(sourceX + 2 * cx + targetX) / 4} labelY={(sourceY + 2 * cy + targetY) / 4} labelStyle={labelStyle} labelBgStyle={labelBgStyle} labelBgPadding={labelBgPadding} labelBgBorderRadius={labelBgBorderRadius} />
}
const edgeTypes = { relation: RelationCurve }
const flowOptions = { hideAttribution: true }

export const WorldView = memo(function WorldView({ state, mode, onAgent, staleRelations, onFile }: {
  state: RunState; mode: 'map' | 'relationships'; onAgent: (id: string) => void; staleRelations: string[]; onFile: (path: string) => void
}) {
  const [relationId, setRelationId] = useState<string | null>(null)
  const [facilityId, setFacilityId] = useState<string | null>(null)
  const speech = useSpeechBubbles(state.runId, state.simulation)
  const mapNodes = useMemo<Node[]>(() => {
    if (!state.map) return []
    const residents = Object.fromEntries(state.map.locations.map(location => [location.id, state.agents.filter(person => person.role === 'npc' && state.frame.positions[person.id] === location.id)]))
    const layout = worldLayout(state.map, Object.fromEntries(Object.entries(residents).map(([id, people]) => [id, people.length])))
    return [
      ...layout.areas.map(area => ({ id: `area-${area.id}`, type: 'area', position: area.position, data: { name: area.name, color: area.color }, style: { width: area.width, height: area.height }, selectable: false, zIndex: -1 })),
      ...state.map.locations.map(location => ({ id: location.id, type: 'facility', position: layout.positions[location.id], zIndex: speech.some(b => b.locationId === location.id) ? 10 : 0, data: { name: location.name, kind: location.kind, people: residents[location.id], speech: speech.filter(b => b.locationId === location.id && residents[location.id].some(p => p.id === b.actorId)), onAgent, ...(state.simulation?.facilities.some(f => f.locationId === location.id) ? { onFacility: () => setFacilityId(location.id) } : {}) } }))
    ]
  }, [state.map, state.frame.positions, state.agents, state.simulation, onAgent, speech])
  const mapEdges = useMemo<Edge[]>(() => state.map ? state.map.connections.map(connection => ({
    id: connection.id, source: connection.from, target: connection.to, type: 'smoothstep', style: { stroke: '#566b60', strokeWidth: 2, strokeDasharray: '5 5', opacity: 0.6 }
  })) : [], [state.map])
  const peopleNodes = useMemo<Node[]>(() => {
    const people = state.agents.filter(a => a.role === 'npc')
    return people.map((agent, index) => ({ id: agent.id, type: 'person', position: { x: 310 + Math.cos(index / people.length * Math.PI * 2 - Math.PI / 2) * 250, y: 270 + Math.sin(index / people.length * Math.PI * 2 - Math.PI / 2) * 200 }, data: { agent, onAgent } }))
  }, [state.agents, onAgent])
  const relationshipEdges: Edge[] = (state.relationships?.relations ?? []).map(relation => {
    const source = peopleNodes.find(node => node.id === relation.source)
    const target = peopleNodes.find(node => node.id === relation.target)
    if (!source || !target) throw new Error(`関係の住民が存在しません: ${relation.id}`)
    const forward = source.position.x < target.position.x
    return {
    id: relation.id, type: 'relation', source: relation.source, target: relation.target, sourceHandle: forward ? 'right-out' : 'left-out', targetHandle: forward ? 'left-in' : 'right-in', label: relation.label,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#a4bd9a' },
    style: { stroke: '#a4bd9a', strokeWidth: relationId === relation.id ? 3 : 1.5, strokeDasharray: staleRelations.includes(relation.id) ? '5 5' : undefined },
    labelStyle: { fill: '#dce5d9', fontSize: 11 }, labelBgStyle: { fill: '#253129' }, labelBgPadding: [8, 5], labelBgBorderRadius: 4
  }})
  const selected = state.relationships?.relations.find(relation => relation.id === relationId)
  const unknown = state.agents.filter(a => a.role === 'npc' && state.frame.positions[a.id] == null)
  const interior = state.simulation?.facilities.find(f => f.locationId === facilityId)
  if (mode === 'map' && interior && state.simulation) return <FacilityInterior key={interior.id} facility={interior} simulation={state.simulation} speech={speech} onBack={() => setFacilityId(null)} onAgent={onAgent} />

  return <div className="world-canvas" data-testid={mode === 'map' ? 'world-map' : 'relationship-graph'}>
    <WorldGraph key={mode} nodes={mode === 'map' ? mapNodes : peopleNodes} edges={mode === 'map' ? mapEdges : relationshipEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      fitView={mode !== 'map'} defaultViewport={{ x: 28, y: 28, zoom: 0.85 }} fitViewOptions={{ padding: 0.18, maxZoom: 1 }} minZoom={0.15} maxZoom={2} nodesDraggable={false} nodesConnectable={false} elementsSelectable colorMode="dark" proOptions={flowOptions}
      onEdgeClick={(_event, edge) => setRelationId(edge.id)} onPaneClick={() => setRelationId(null)}>
      <Background color="#4b62544d" gap={28} size={1} /><Controls showInteractive={false} />
    </WorldGraph>
    <div className="map-caption"><span className="eyebrow">{mode === 'map' ? 'WORLD MAP' : 'SOCIAL OBSERVATORY'}</span><h2>{mode === 'map' ? state.map?.name : '関係の輪郭'}</h2><p>{mode === 'map' ? '同じ場所から、物語が生まれる。' : 'それぞれの記憶に映る、誰かとの関係。'}</p></div>
    {mode === 'map' && <div className="map-legend"><span><span className="legend-dot" /> 住民</span><span><MapPin size={12} /> {state.map?.locations.length} 施設</span><span>地図 v{state.map?.revision}</span></div>}
    {mode === 'map' && unknown.length > 0 && <div className="unplaced">位置未設定 {unknown.map(a => <button key={a.id} onClick={() => onAgent(a.id)}>{a.name}<ArrowUpRight size={11} /></button>)}</div>}
    {mode === 'relationships' && !state.relationships?.relations.length && <div className="observation-wait"><GitBranch size={22} /><strong>まだ関係が記録されていません</strong><p>NPCが睡眠時に自分の記憶を根拠として関係を整理すると、矢印が表示されます。日数だけでは増えません。</p></div>}
    {mode === 'relationships' && state.relationships && <div className="observation-time">{state.simulation?.memoryProgress || state.relationships.relations.some(r => r.observedTurn !== undefined) ? '本人の整理結果・矢印ごとに更新' : `Day ${state.relationships.day} 終了時の観測`} <span>· {state.relationships.relations.length} 関係</span>{staleRelations.length > 0 && <b>記憶更新あり</b>}</div>}
    {mode === 'relationships' && selected && state.relationships && <RelationDetail key={selected.id} relation={selected} snapshot={state.relationships} agents={state.agents} stale={staleRelations.includes(selected.id)} onFile={onFile} onClose={() => setRelationId(null)} />}
    {mode === 'relationships' && state.relationships && !selected && <div className="relation-shortcuts">{state.relationships.relations.map(relation => <button key={relation.id} onClick={() => setRelationId(relation.id)}>{state.agents.find(a => a.id === relation.source)?.name} → {state.agents.find(a => a.id === relation.target)?.name}<span>{relation.label}</span></button>)}</div>}
  </div>
})

function RelationDetail({ relation, snapshot, agents, stale, onFile, onClose }: { relation: RelationshipSnapshot['relations'][number]; snapshot: RelationshipSnapshot; agents: AgentDescriptor[]; stale: boolean; onFile: (path: string) => void; onClose: () => void }) {
  const [selected, setSelected] = useState<{ ownerId: string; memoryId: string; revision: number } | null>(null)
  const selectedEvidence = selected && relation.evidence.some(evidence => 'memoryId' in evidence && evidence.ownerId === selected.ownerId && evidence.memoryId === selected.memoryId && evidence.revision === selected.revision) ? selected : null
  const memory = relation.evidence.some(e => 'memoryId' in e)
  return <div className="relation-detail" data-testid="relation-detail"><button className="icon-button close-detail" onClick={onClose} aria-label="関係の詳細を閉じる"><X size={14} /></button><span className="eyebrow">SUBJECTIVE RELATIONSHIP</span><h3>{agents.find(a => a.id === relation.source)?.name} → {agents.find(a => a.id === relation.target)?.name}</h3><span className="relation-label">{relation.label}</span><p>{relation.description}</p>
    <small>{memory ? `本人が turn ${relation.observedTurn} に更新` : `Day ${snapshot.day} / ${new Date(snapshot.observedAt).toLocaleTimeString('ja-JP')} 観測`}</small>
    {stale && <div className="stale-label">観測後に根拠ファイルが変更されています</div>}<div className="evidence-label">{memory ? '当時の記憶を確認' : '根拠の記憶ファイル'}</div>
    {relation.evidence.map(evidence => 'path' in evidence ? <button className="evidence" key={evidence.path} onClick={() => onFile(evidence.path)}><FileText size={13} />{evidence.path}<ArrowUpRight size={13} /></button> : <button className="evidence" key={`${evidence.memoryId}/${evidence.revision}`} onClick={() => setSelected(evidence)}><FileText size={13} />{evidence.memoryId} · v{evidence.revision}<ArrowUpRight size={13} /></button>)}
    {selectedEvidence && <MemoryEvidence key={`${selectedEvidence.ownerId}/${selectedEvidence.memoryId}/${selectedEvidence.revision}`} {...selectedEvidence} />}
    {!memory && <small className="demo-explanation">デモの関係ラベルです。任意の記憶の意味抽出は未接続です。</small>}
  </div>
}
