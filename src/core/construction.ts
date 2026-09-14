import type { MapDocument } from '../shared/contracts'
import type { LifeFacility } from './life-contracts'

export function constructedMap(base: MapDocument, facilities: LifeFacility[]): MapDocument {
  const additions = facilities.filter(f => f.construction)
  if (!additions.length) return base
  const areaId = `${additions[0].id}-area`, columns = Math.min(3, additions.length), height = Math.ceil(additions.length / columns) * 180 + 80
  const area = { id: areaId, name: '建設された施設', position: { x: 40, y: base.bounds.height + 80 }, width: columns * 260 + 80, height, color: '#4c7565' }
  return { ...base, revision: base.revision + additions.length, bounds: { width: Math.max(base.bounds.width, area.width + 80), height: base.bounds.height + height + 160 },
    areas: [...base.areas, area],
    locations: [...base.locations, ...additions.map((f, i) => ({ id: f.locationId, name: f.name, kind: f.type, areaId, position: { x: area.position.x + 40 + (i % columns) * 260, y: area.position.y + 50 + Math.floor(i / columns) * 180 } }))],
    connections: [...base.connections, ...additions.map(f => ({ id: `${f.id}-road`, from: f.construction!.connectedLocationId, to: f.locationId }))]
  }
}
