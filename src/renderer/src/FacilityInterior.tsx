import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ArrowLeft, Home, RotateCcw, UserRound } from 'lucide-react'
import type { LifeActor, LifeFacility, SimulationSnapshot, Volume, Voice, Voxel } from '../../core/life-contracts'
import { homeAt, speechRecipients } from '../../core/spatial'
import { SpeechBubble } from './SpeechBubble'
import type { SpeechBubble as Speech } from './world-presentation'
import { speechTail } from './speech-tail'
import './life.css'

interface Viewport { scene: THREE.Scene; content: THREE.Group; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; controls: OrbitControls; draw(): void; reset(): void }
const vector = (p: Voxel) => new THREE.Vector3(p.x + 0.5, p.z + 0.5, p.y + 0.5)
function dispose(group: THREE.Group): void {
  for (const object of [...group.children]) {
    object.traverse(child => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Sprite) {
        if ('geometry' in child) child.geometry.dispose()
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
          if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose()
          material.dispose()
        }
      }
    })
    group.remove(object)
  }
}
function box(bounds: Volume, color: number, opacity: number, maxZ: number): THREE.Mesh | null {
  const top = Math.min(bounds.max.z, maxZ)
  if (top < bounds.min.z) return null
  const geometry = new THREE.BoxGeometry(bounds.max.x - bounds.min.x + 1, top - bounds.min.z + 1, bounds.max.y - bounds.min.y + 1)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))
  mesh.position.set((bounds.min.x + bounds.max.x + 1) / 2, (bounds.min.z + top + 1) / 2, (bounds.min.y + bounds.max.y + 1) / 2)
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.65 }))
  mesh.add(edges)
  return mesh
}
function label(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 512; canvas.height = 80
  const context = canvas.getContext('2d')!
  context.font = '28px "Yu Gothic UI", sans-serif'; context.textAlign = 'center'
  context.fillStyle = '#152119e8'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#e1ebda'; context.fillText(text, 256, 49, 490)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true }))
  sprite.scale.set(5, 0.8, 1)
  return sprite
}
function clipping(bounds: Volume): THREE.Plane[] {
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -bounds.min.x), new THREE.Plane(new THREE.Vector3(-1, 0, 0), bounds.max.x + 1),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -bounds.min.y), new THREE.Plane(new THREE.Vector3(0, 0, -1), bounds.max.y + 1),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -bounds.min.z), new THREE.Plane(new THREE.Vector3(0, -1, 0), bounds.max.z + 1)
  ]
}

export function FacilityInterior({ facility, simulation, speech, onBack, onAgent }: { facility: LifeFacility; simulation: SimulationSnapshot; speech: Speech[]; onBack: () => void; onAgent: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const viewport = useRef<Viewport | null>(null)
  const click = useRef<(id: string) => void>(() => undefined)
  const projectSpeech = useRef<() => void>(() => undefined)
  const speechLayer = useRef<HTMLDivElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [homeId, setHomeId] = useState<string | null>(null)
  const [maxZ, setMaxZ] = useState(facility.dimensions.z - 1)
  const [voice, setVoice] = useState<Voice>('medium')
  const [error, setError] = useState<string | null>(null)
  const people = useMemo(() => simulation.actors.filter(a => a.activity !== 'dead' && a.locationId === facility.locationId), [simulation.actors, facility.locationId])
  const selected = people.find(a => a.id === selectedId)
  const home = facility.layout?.homes.find(h => h.id === homeId)
  const recipients = selected?.position ? speechRecipients(facility, selected, people, voice) : []
  const visibleSpeech = speech.filter(b => b.locationId === facility.locationId && people.some(a => a.id === b.actorId && a.position))
  click.current = id => { setSelectedId(id); onAgent(id) }
  projectSpeech.current = () => {
    const view = viewport.current, element = host.current, layer = speechLayer.current
    if (!view || !element || !layer) return
    const anchors = new Map<string, { x: number; y: number }>()
    for (const marker of layer.querySelectorAll<HTMLElement>('.interior-character')) {
      const actor = people.find(a => a.id === marker.dataset.actorId)!
      if (!actor.position) { marker.hidden = true; continue }
      const point = vector(actor.position).project(view.camera)
      marker.hidden = actor.position.z > maxZ || point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1
      if (marker.hidden) continue
      const x = (point.x + 1) / 2 * element.clientWidth, y = (1 - point.y) / 2 * element.clientHeight
      marker.style.left = `${x}px`; marker.style.top = `${y}px`
      anchors.set(actor.id, { x, y: y - marker.offsetHeight - 3 })
    }
    const tails = new Map([...layer.querySelectorAll<SVGPolygonElement>('.interior-speech-tail')].map(tail => [tail.dataset.actorId, tail]))
    const placed: { x: number; y: number; height: number }[] = []
    for (const bubble of layer.querySelectorAll<HTMLElement>('.interior-speech-anchor')) {
      const anchor = anchors.get(bubble.dataset.actorId!)
      const tail = tails.get(bubble.dataset.actorId!)!
      bubble.hidden = !anchor
      tail.style.display = anchor ? '' : 'none'
      if (bubble.hidden) continue
      const width = element.clientWidth, height = bubble.offsetHeight
      const { x: anchorX, y: anchorY } = anchor!
      const xs = [anchorX, ...Array.from({ length: Math.ceil(width / 222) }, (_, i) => 110 + i * 222)].map(x => Math.max(110, Math.min(width - 110, x)))
      const ys = [anchorY, ...Array.from({ length: Math.ceil(element.clientHeight / (height + 12)) }, (_, i) => height + i * (height + 12))].map(y => Math.max(height, Math.min(element.clientHeight, y)))
      const candidates = xs.flatMap(x => ys.map(y => ({ x, y, score: Math.hypot(x - anchorX, y - anchorY) + (y - 18 > anchorY ? 100_000 : 0)
        + placed.reduce((total, other) => total + Math.max(0, 222 - Math.abs(other.x - x)) * Math.max(0, Math.min(y, other.y) - Math.max(y - height, other.y - other.height) + 12) * 1000, 0)
        + [...anchors.values()].reduce((total, person) => total + Math.max(0, Math.min(x + 105, person.x + 20) - Math.max(x - 105, person.x - 20)) * Math.max(0, Math.min(y - 18, person.y + 43) - Math.max(y - height, person.y)) * 1000, 0)
      })))
      candidates.sort((a, b) => a.score - b.score)
      const { x, y } = candidates[0]
      bubble.style.left = `${x}px`; bubble.style.top = `${y}px`
      tail.setAttribute('points', speechTail({ x: x - bubble.offsetWidth / 2, y: y - height, width: bubble.offsetWidth, height: height - 18 }, anchor!))
      placed.push({ x, y, height })
    }
  }
  const selectHome = (id: string, bounds: Volume) => {
    const view = viewport.current
    if (homeId === id) { setHomeId(null); view?.reset(); return }
    setHomeId(id)
    if (!view) return
    const center = vector(bounds.min).add(vector(bounds.max)).multiplyScalar(0.5)
    const extent = Math.max(bounds.max.x - bounds.min.x + 1, bounds.max.y - bounds.min.y + 1, bounds.max.z - bounds.min.z + 1)
    const direction = view.camera.position.clone().sub(view.controls.target).normalize()
    view.camera.position.copy(center).addScaledVector(direction, extent * 3)
    view.controls.target.copy(center); view.controls.update(); view.draw()
  }

  useEffect(() => {
    const element = host.current!
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true }) }
    catch (error) { setError(`3D画面を初期化できません: ${error instanceof Error ? error.message : String(error)}`); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.localClippingEnabled = true
    renderer.domElement.setAttribute('aria-label', `${facility.name}の3D内部`)
    renderer.domElement.dataset.testid = 'interior-canvas'
    element.appendChild(renderer.domElement)
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#152019')
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
    const content = new THREE.Group(); scene.add(content)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.maxPolarAngle = Math.PI * 0.85; controls.minDistance = 1
    const draw = () => { renderer.render(scene, camera); projectSpeech.current() }
    const reset = () => {
      const extent = Math.max(facility.dimensions.x, facility.dimensions.y, facility.dimensions.z)
      const center = new THREE.Vector3(facility.dimensions.x / 2, facility.dimensions.z / 2, facility.dimensions.y / 2)
      camera.far = Math.max(10000, extent * 10); camera.updateProjectionMatrix()
      camera.position.copy(center).add(new THREE.Vector3(extent * 0.85, extent * 1.15, extent * 1.25))
      controls.target.copy(center); controls.update(); draw()
    }
    viewport.current = { scene, content, camera, renderer, controls, draw, reset }
    const resize = () => {
      const width = element.clientWidth, height = element.clientHeight
      if (!width || !height) return
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); draw()
    }
    const observer = new ResizeObserver(resize); observer.observe(element)
    controls.addEventListener('change', draw)
    resize(); reset()
    return () => {
      observer.disconnect(); controls.dispose(); dispose(content); renderer.dispose()
      element.removeChild(renderer.domElement); viewport.current = null
    }
  }, [facility.id, facility.name, facility.dimensions.x, facility.dimensions.y, facility.dimensions.z])

  useEffect(() => {
    const view = viewport.current
    if (!view) return
    dispose(view.content)
    const outer: Volume = { min: { x: 0, y: 0, z: 0 }, max: { x: facility.dimensions.x - 1, y: facility.dimensions.y - 1, z: Math.min(maxZ, facility.dimensions.z - 1) } }
    const outline = box(outer, 0x799a83, 0.025, maxZ)
    if (outline) view.content.add(outline)
    const grid = new THREE.GridHelper(Math.max(facility.dimensions.x, facility.dimensions.y), Math.min(60, Math.max(facility.dimensions.x, facility.dimensions.y)), 0x45634d, 0x2d4536)
    grid.position.set(facility.dimensions.x / 2, 0, facility.dimensions.y / 2); view.content.add(grid)
    for (const region of facility.layout?.regions ?? []) {
      const regionBox = box(region.bounds, 0x90b6d0, 0.06, maxZ)
      if (regionBox) view.content.add(regionBox)
    }
    for (const house of facility.layout?.homes ?? []) {
      const houseBox = box(house.bounds, house.id === homeId ? 0xebc785 : 0xc7aa78, house.id === homeId ? 0.12 : 0.055, maxZ)
      if (!houseBox) continue
      view.content.add(houseBox)
      const name = label(`${house.name} · ${house.householdId}`)
      name.position.copy(houseBox.position); name.position.y = Math.min(house.bounds.max.z, maxZ) + 1.65
      view.content.add(name)
    }
    if (selected?.position) {
      const sourceHome = homeAt(facility, selected.position)
      const boundary = sourceHome ? { min: sourceHome.bounds.min, max: { ...sourceHome.bounds.max, z: Math.min(sourceHome.bounds.max.z, maxZ) } } : outer
      if (voice === 'high') {
        const reach = box(boundary, 0x7edabc, 0.08, maxZ)
        if (reach) view.content.add(reach)
      } else {
        const reach = new THREE.Mesh(new THREE.SphereGeometry(voice === 'low' ? 1 : 5, 32, 24), new THREE.MeshBasicMaterial({ color: 0x7edabc, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: clipping(boundary) }))
        reach.position.copy(vector(selected.position)); view.content.add(reach)
      }
    }
    view.draw()
  }, [facility, people, selected, selectedId, homeId, maxZ, voice])

  useEffect(() => { projectSpeech.current() }, [speech, people, maxZ])

  const describe = (actor: LifeActor) => actor.position ? `(${actor.position.x}, ${actor.position.y}, ${actor.position.z})` : '位置選択中'
  return <section className="facility-interior" data-testid="facility-interior">
    <div className="interior-heading"><button className="button compact" onClick={onBack}><ArrowLeft size={13} />町へ戻る</button><strong>{facility.name}</strong><span>{facility.dimensions.x} × {facility.dimensions.y} × {facility.dimensions.z}</span><button className="icon-button" aria-label="3D視点をリセット" onClick={() => viewport.current?.reset()}><RotateCcw size={14} /></button></div>
    <div className="interior-options"><label>高さ上限 z={maxZ}<input aria-label="表示する高さ上限" type="range" min={0} max={facility.dimensions.z - 1} value={maxZ} onChange={event => setMaxZ(Number(event.target.value))} /></label><label>声の範囲<select aria-label="声量プレビュー" value={voice} onChange={event => setVoice(event.target.value as Voice)}><option value="low">低 · 1マス</option><option value="medium">中 · 5マス</option><option value="high">高 · 全体</option></select></label></div>
    <div className="interior-scene" ref={host}>
      {error && <p role="alert" className="interior-render-error">{error}</p>}
      <div className="interior-speech-layer" ref={speechLayer}>
        <svg className="interior-speech-connectors" aria-hidden="true">{visibleSpeech.map(b => <polygon className="interior-speech-tail" data-actor-id={b.actorId} key={b.sequence} />)}</svg>
        {people.filter(a => a.position).map(a => <button className={`interior-character ${a.id === selectedId ? 'selected' : a.activity === 'sleeping' ? 'sleeping' : recipients.includes(a.id) ? 'heard' : ''}`} data-actor-id={a.id} key={a.id} aria-label={`キャラクターの${a.name}を選択`} title={`${a.name}${a.activity === 'sleeping' ? '（睡眠中）' : ''}`} onClick={() => click.current(a.id)}><UserRound size={22} strokeWidth={1.8} /></button>)}
        {visibleSpeech.map(b => <div className="interior-speech-anchor" data-actor-id={b.actorId} key={b.sequence}><SpeechBubble speech={b} name={people.find(a => a.id === b.actorId)!.name} onSelect={() => click.current(b.actorId)} /></div>)}
      </div>
    </div>
    <div className="interior-info">
      <div className="interior-homes">{facility.layout?.homes.map(h => <button className={homeId === h.id ? 'selected' : ''} key={h.id} onClick={() => selectHome(h.id, h.bounds)}><Home size={12} />{h.name}<small>{h.householdId}</small></button>)}</div>
      {home && <p>{home.name}: {home.description} · ({home.bounds.min.x},{home.bounds.min.y},{home.bounds.min.z})〜({home.bounds.max.x},{home.bounds.max.y},{home.bounds.max.z})</p>}
      <div className="interior-people">{people.map(a => <button key={a.id} aria-label={`施設内の${a.name}を選択`} className={selectedId === a.id ? 'selected' : ''} onClick={() => click.current(a.id)}>{a.name} <span>{describe(a)}</span>{a.activity === 'sleeping' && <small>睡眠中</small>}</button>)}</div>
      {selected && <p data-testid="voice-recipients">{selected.name}の声が届く相手: {recipients.map(id => people.find(a => a.id === id)!.name).join('、') || 'なし'}{selected.position && homeAt(facility, selected.position) && '（同じ家の中のみ）'}</p>}
      <details><summary>座標の用途 · {facility.layout?.regions.length ?? 0}領域</summary>{facility.layout?.regions.map(r => <p key={r.id}>{r.name}: {r.description} · ({r.bounds.min.x},{r.bounds.min.y},{r.bounds.min.z})〜({r.bounds.max.x},{r.bounds.max.y},{r.bounds.max.z})</p>)}</details>
      {facility.type === 'residential' && <small>家の内外・別の家の間では、声量によらず声は届きません。</small>}
      {!facility.layout && <p>施設モデルが内部を準備しています。</p>}
    </div>
  </section>
}
