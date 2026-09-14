import type { SimulationSnapshot } from './life-contracts'
import { contains, LifeRuleError } from './spatial'
import { ECONOMY_RULES, economySeedSchema, economyToolSchemas, itemDecisionSchema, type Economy, type EconomySeed, type EconomyRecord, type Holding, type ItemDefinition, type ItemRequest, type Owner, type Storage } from './economy-contracts'

export const ownerKey = (owner: Owner) => `${owner.kind}:${owner.id}`
const sameOwner = (a: Owner, b: Owner) => ownerKey(a) === ownerKey(b)
const npcOwner = (id: string): Owner => ({ kind: 'npc', id })
const companyOwner = (id: string): Owner => ({ kind: 'organization', id })
const unique = () => crypto.randomUUID()
const clamp = (value: number) => Math.max(0, Math.min(100, value))
export const initialVitals = (): Economy['vitals'][string] => ({ hp: ECONOMY_RULES.initialVital, hunger: ECONOMY_RULES.initialVital, san: ECONOMY_RULES.initialVital, lastWorkTurn: null, heirId: null })
const emptyAccount = (): Economy['accounts'][string] => ({ balance: 0, sales: 0, purchases: 0, wages: 0, exports: 0 })
const checked = (value: number) => { if (!Number.isSafeInteger(value) || value < 0) throw new LifeRuleError(`金額・数量が安全な整数範囲外です: ${value}`); return value }
const state = (world: SimulationSnapshot) => { if (!world.economy) throw new LifeRuleError('この世界は経済機能に対応していません'); return world.economy }
const person = (world: SimulationSnapshot, id: string) => { const actor = world.actors.find(a => a.id === id); if (!actor) throw new LifeRuleError(`住民が存在しません: ${id}`); return actor }
const alive = (world: SimulationSnapshot, id: string) => { const actor = person(world, id); if (actor.activity === 'dead') throw new LifeRuleError(`死亡した住民です: ${id}`); return actor }
const item = (economy: Economy, id: string) => { const entry = economy.catalog.find(e => e.item.id === id); if (!entry) throw new LifeRuleError(`登録品がありません: ${id}`); return entry }
const account = (economy: Economy, owner: Owner) => { const value = economy.accounts[ownerKey(owner)]; if (!value) throw new LifeRuleError(`口座がありません: ${ownerKey(owner)}`); return value }
const holding = (economy: Economy, id: string) => { const value = economy.holdings.find(h => h.id === id); if (!value) throw new LifeRuleError(`保管品がありません: ${id}`); return value }
export function manages(economy: Economy, actorId: string, owner: Owner): boolean {
  return owner.kind === 'npc' ? owner.id === actorId : economy.companies[owner.id]?.managerId === actorId
}
function authorize(economy: Economy, actorId: string, owner: Owner): void {
  if (!manages(economy, actorId, owner)) throw new LifeRuleError(`資産を操作する権限がありません: ${actorId}/${ownerKey(owner)}`)
}
function storageExists(world: SimulationSnapshot, storage: Storage): void {
  if (storage.kind === 'carried') { person(world, storage.actorId); return }
  if (storage.kind === 'facility' && world.facilities.some(f => f.id === storage.facilityId && f.layout)) return
  if (storage.kind === 'home' && world.facilities.some(f => f.layout?.homes.some(h => h.id === storage.homeId))) return
  throw new LifeRuleError(`保管場所が存在しません: ${JSON.stringify(storage)}`)
}
function access(world: SimulationSnapshot, actorId: string, storage: Storage): void {
  const actor = alive(world, actorId)
  storageExists(world, storage)
  if (storage.kind === 'carried' && storage.actorId === actorId) return
  if (storage.kind === 'facility' && world.facilities.some(f => f.id === storage.facilityId && f.locationId === actor.locationId) && actor.position) return
  if (storage.kind === 'home' && world.facilities.some(f => f.locationId === actor.locationId && f.layout?.homes.some(h => h.id === storage.homeId && actor.position && contains(h.bounds, actor.position)))) return
  throw new LifeRuleError(`保管場所へ現地でアクセスしてください: ${actorId}/${JSON.stringify(storage)}`)
}
function destination(world: SimulationSnapshot, actorId: string, owner: Owner, storage: Storage): void {
  access(world, actorId, storage)
  if (storage.kind === 'carried' && (owner.kind !== 'npc' || owner.id !== storage.actorId)) throw new LifeRuleError('携帯品の所有者は携帯する本人にしてください')
}
function accessibleOffer(world: SimulationSnapshot, buyerId: string, value: Holding): void {
  if (value.storage.kind !== 'carried') { access(world, buyerId, value.storage); return }
  const buyer = alive(world, buyerId), seller = alive(world, value.storage.actorId)
  if (buyer.locationId !== seller.locationId || !buyer.position || !seller.position) throw new LifeRuleError('売り手と同じ場所で受け取ってください')
  const homes = world.facilities.find(f => f.locationId === buyer.locationId)!.layout!.homes
  if (homes.find(h => contains(h.bounds, buyer.position!))?.id !== homes.find(h => contains(h.bounds, seller.position!))?.id) throw new LifeRuleError('家の内外をまたぐ受け渡しはできません')
}
const reserved = (economy: Economy, id: string) => economy.listings.filter(l => l.holdingId === id).reduce((n, l) => n + l.quantity, 0)
function available(economy: Economy, value: Holding, amount: number): void {
  if (value.quantity - reserved(economy, value.id) < amount) throw new LifeRuleError(`予約されていない在庫が不足しています: ${value.id}/${amount}`)
}
function debit(economy: Economy, owner: Owner, amount: number): void {
  checked(amount)
  const value = account(economy, owner)
  if (value.balance < amount) throw new LifeRuleError(`残高が不足しています: ${ownerKey(owner)}/${amount}`)
  value.balance -= amount
}
function credit(economy: Economy, owner: Owner, amount: number): void {
  const value = account(economy, owner); value.balance = checked(value.balance + amount)
}
function record(world: SimulationSnapshot, actorId: string, kind: string, text: string, owners: Owner[] = [npcOwner(actorId)], values: Holding[] = [], amount = 0, participants: string[] = []): EconomyRecord {
  return { id: unique(), turn: world.turn, kind, actorId, text, owners: owners.map(o => ({ ...o })), holdingIds: values.map(v => v.id), previousIds: [...new Set(values.map(v => v.lastRecordId))], amount,
    participants: [...new Set([actorId, ...participants, ...owners.flatMap(o => o.kind === 'npc' ? [o.id] : state(world).companies[o.id]?.managerId ? [state(world).companies[o.id].managerId!] : [])])] }
}
function addHolding(economy: Economy, definition: ItemDefinition, owner: Owner, storage: Storage, amount: number, recordId: string, originId = recordId, individual = definition.kind !== 'consumable', durability = definition.durability): Holding[] {
  const result: Holding[] = []
  if (!individual) {
    const existing = economy.holdings.find(h => h.itemId === definition.id && sameOwner(h.owner, owner) && JSON.stringify(h.storage) === JSON.stringify(storage) && !h.individual && h.originId === originId && h.quantity + amount <= 10000)
    if (existing) { existing.quantity += amount; existing.lastRecordId = recordId; return [existing] }
  }
  for (let left = amount; left > 0;) {
    const count = individual ? 1 : left
    const value: Holding = { id: unique(), itemId: definition.id, owner: { ...owner }, storage: { ...storage }, quantity: count, durability, individual, originId, lastRecordId: recordId }
    economy.holdings.push(value); result.push(value); left -= count
  }
  return result
}
function remove(economy: Economy, value: Holding, amount: number): void {
  value.quantity -= amount
  if (!value.quantity) economy.holdings = economy.holdings.filter(h => h.id !== value.id)
}
export function addCompany(economy: Economy, id: string, managerId: string): void {
  economy.companies[id] = { managerId }; economy.accounts[ownerKey(companyOwner(id))] = emptyAccount()
}
export function validateEconomySeed(input: unknown, npcIds: string[], facilityIds: string[], organizationIds: string[] = []): EconomySeed {
  const seed = economySeedSchema.parse(input)
  if (JSON.stringify(seed.balances.map(b => b.npcId).sort()) !== JSON.stringify([...npcIds].sort())) throw new LifeRuleError('初期資金は全NPCに重複なく指定してください')
  if (new Set(seed.catalog.map(e => e.item.id)).size !== seed.catalog.length || new Set(seed.catalog.map(e => e.item.name.normalize('NFKC').toLowerCase())).size !== seed.catalog.length) throw new LifeRuleError('初期登録品が重複しています')
  for (const entry of seed.catalog) {
    for (const owner of entry.licensees) if (!(owner.kind === 'npc' ? npcIds : organizationIds).includes(owner.id)) throw new LifeRuleError(`初期取得権の所有者が存在しません: ${ownerKey(owner)}`)
    const primary = entry.item.primary
    if (primary && (!facilityIds.includes(primary.facilityId) || primary.toolItemId && seed.catalog.find(e => e.item.id === primary.toolItemId)?.item.kind !== 'durable')) throw new LifeRuleError(`初期一次産業の施設・道具が不正です: ${entry.item.id}`)
  }
  for (const value of seed.holdings) if (!npcIds.includes(value.npcId) || !seed.catalog.some(e => e.item.id === value.itemId)) throw new LifeRuleError(`初期所持品の参照が不正です: ${value.npcId}/${value.itemId}`)
  return seed
}
export function initializeEconomy(world: SimulationSnapshot, input: EconomySeed): EconomyRecord[] {
  const seed = validateEconomySeed(input, world.actors.map(a => a.id), world.facilities.map(f => f.id), world.organizations?.map(o => o.id))
  const economy: Economy = { version: 1, currency: seed.currency, processedTurn: 0, catalog: structuredClone(seed.catalog), vitals: {}, accounts: {}, companies: {}, holdings: [], listings: [], employment: [], requests: [] }
  world.economy = economy
  for (const entry of seed.balances) { economy.vitals[entry.npcId] = initialVitals(); economy.accounts[ownerKey(npcOwner(entry.npcId))] = { ...emptyAccount(), balance: entry.amount } }
  for (const organization of world.organizations ?? []) addCompany(economy, organization.id, organization.founderId)
  const records: EconomyRecord[] = []
  for (const entry of seed.holdings) {
    person(world, entry.npcId)
    const definition = item(economy, entry.itemId).item
    const r = record(world, entry.npcId, 'initial', `初期所持品: ${definition.name} ×${entry.quantity}`)
    const values = addHolding(economy, definition, npcOwner(entry.npcId), { kind: 'carried', actorId: entry.npcId }, entry.quantity, r.id)
    r.holdingIds = values.map(v => v.id); records.push(r)
  }
  validateEconomy(world)
  return records
}
function validateDefinition(world: SimulationSnapshot, definition: ItemDefinition): void {
  if (definition.primary && !world.facilities.some(f => f.id === definition.primary!.facilityId)) throw new LifeRuleError(`一次産業の施設がありません: ${definition.id}`)
  if (definition.primary?.toolItemId && state(world).catalog.find(e => e.item.id === definition.primary!.toolItemId)?.item.kind !== 'durable') throw new LifeRuleError(`必要な道具は登録済み耐久品を指定してください: ${definition.id}`)
}
export function validateEconomy(world: SimulationSnapshot): void {
  const economy = state(world)
  if (economy.processedTurn > world.turn) throw new LifeRuleError('経済の日付が世界より先です')
  if (new Set(economy.catalog.map(e => e.item.id)).size !== economy.catalog.length || new Set(economy.holdings.map(h => h.id)).size !== economy.holdings.length) throw new LifeRuleError('経済IDが重複しています')
  for (const entries of [economy.listings, economy.employment, economy.requests]) if (new Set(entries.map(e => e.id)).size !== entries.length) throw new LifeRuleError('出品・雇用・申請IDが重複しています')
  const expectedAccounts = [...world.actors.map(a => ownerKey(npcOwner(a.id))), ...(world.organizations ?? []).map(o => ownerKey(companyOwner(o.id)))].sort()
  if (JSON.stringify(Object.keys(economy.accounts).sort()) !== JSON.stringify(expectedAccounts) || JSON.stringify(Object.keys(economy.vitals).sort()) !== JSON.stringify(world.actors.map(a => a.id).sort()) || JSON.stringify(Object.keys(economy.companies).sort()) !== JSON.stringify((world.organizations ?? []).map(o => o.id).sort())) throw new LifeRuleError('経済の口座・生存状態・会社と世界の参照が一致しません')
  for (const actor of world.actors) {
    if (!economy.vitals[actor.id]) throw new LifeRuleError(`生存状態がありません: ${actor.id}`)
    account(economy, npcOwner(actor.id))
    if (economy.vitals[actor.id].heirId) person(world, economy.vitals[actor.id].heirId!)
    if (economy.vitals[actor.id].lastWorkTurn !== null && economy.vitals[actor.id].lastWorkTurn! > world.turn) throw new LifeRuleError(`勤務ターンが未来です: ${actor.id}`)
  }
  for (const [id, company] of Object.entries(economy.companies)) {
    if (!world.organizations?.some(o => o.id === id)) throw new LifeRuleError(`会社の組織がありません: ${id}`)
    if (company.managerId) alive(world, company.managerId)
    account(economy, companyOwner(id))
  }
  for (const entry of economy.catalog) { validateDefinition(world, entry.item); for (const owner of entry.licensees) account(economy, owner) }
  for (const value of economy.holdings) {
    const definition = item(economy, value.itemId).item; account(economy, value.owner)
    if (value.storage.kind === 'carried') {
      if (value.owner.kind !== 'npc' || value.owner.id !== value.storage.actorId) throw new LifeRuleError(`携帯品の所有者が不一致です: ${value.id}`)
      person(world, value.storage.actorId)
    } else storageExists(world, value.storage)
    if (value.individual && value.quantity !== 1 || (definition.kind === 'durable') !== (value.durability !== null) || value.durability !== null && value.durability > definition.durability!) throw new LifeRuleError(`耐久・個数が不正です: ${value.id}`)
    if (reserved(economy, value.id) > value.quantity) throw new LifeRuleError(`出品が在庫を超えています: ${value.id}`)
  }
  for (const offer of economy.listings) { holding(economy, offer.holdingId); if (offer.targetId) alive(world, offer.targetId) }
  for (const contract of economy.employment) {
    account(economy, companyOwner(contract.organizationId))
    if (contract.status === 'active' && !contract.employeeId) throw new LifeRuleError(`雇用契約に従業員がいません: ${contract.id}`)
    if (contract.employeeId) alive(world, contract.employeeId)
    if (!world.facilities.some(f => f.id === contract.facilityId)) throw new LifeRuleError(`勤務地がありません: ${contract.id}`)
    if (contract.primaryItemId && item(economy, contract.primaryItemId).item.primary?.facilityId !== contract.facilityId) throw new LifeRuleError(`生産と勤務地が不一致です: ${contract.id}`)
  }
  for (const request of economy.requests) { person(world, request.actorId); if (request.organizationId) account(economy, companyOwner(request.organizationId)); if (request.itemId) item(economy, request.itemId) }
}
export function registerItemDecision(world: SimulationSnapshot, requestId: string, input: unknown): EconomyRecord {
  const economy = state(world), request = economy.requests.find(r => r.id === requestId)
  if (!request || request.status !== 'running') throw new LifeRuleError(`処理中の申請がありません: ${requestId}`)
  const decision = itemDecisionSchema.parse(input)
  if (person(world, request.actorId).activity === 'dead') {
    request.status = 'rejected'; request.reason = '審査中に申請者が死亡しました'
    return record(world, request.actorId, 'registration', request.reason)
  }
  if (decision.decision === 'approved') {
    if (economy.catalog.some(e => e.item.id === decision.item.id || e.item.name.normalize('NFKC').toLowerCase() === decision.item.name.normalize('NFKC').toLowerCase())) throw new LifeRuleError(`登録済み品物の重複申請です: ${decision.item.name}`)
    validateDefinition(world, decision.item)
    economy.catalog.push({ item: decision.item, licensees: [npcOwner(request.actorId), ...(request.organizationId ? [companyOwner(request.organizationId)] : [])] })
    request.itemId = decision.item.id
  }
  request.status = decision.decision; request.reason = decision.reason
  return record(world, request.actorId, 'registration', `品物「${request.name}」の申請: ${decision.decision === 'approved' ? '許可' : '拒否'}。${decision.reason}`)
}
export function validateEconomyHistory(world: SimulationSnapshot, records: EconomyRecord[]): void {
  const known = new Set<string>()
  for (const record of records) {
    if (known.has(record.id) || record.turn > world.turn || record.previousIds.some(id => !known.has(id))) throw new LifeRuleError(`経済履歴の参照が不正です: ${record.id}`)
    known.add(record.id)
  }
  for (const value of state(world).holdings) if (!known.has(value.originId) || !known.has(value.lastRecordId)) throw new LifeRuleError(`保管品の来歴がありません: ${value.id}`)
}
export function economySituation(world: SimulationSnapshot, actorId: string) {
  const economy = state(world)
  const owners = [npcOwner(actorId), ...Object.entries(economy.companies).filter(([, c]) => c.managerId === actorId).map(([id]) => companyOwner(id))]
  const owned = new Set(owners.map(ownerKey))
  return { currency: economy.currency, vitals: economy.vitals[actorId], accounts: Object.fromEntries(owners.map(o => [ownerKey(o), account(economy, o)])),
    holdings: economy.holdings.filter(h => owned.has(ownerKey(h.owner))),
    catalog: economy.catalog.map(e => ({ item: e.item, canAcquireAs: e.licensees.filter(o => owned.has(ownerKey(o))) })),
    companies: economy.companies,
    listings: economy.listings.filter(l => !l.targetId || l.targetId === actorId || owned.has(ownerKey(holding(economy, l.holdingId).owner))).map(l => { const h = holding(economy, l.holdingId); return { ...l, itemId: h.itemId, owner: h.owner, storage: h.storage, durability: h.durability } }),
    employment: economy.employment.filter(c => c.employeeId === actorId || economy.companies[c.organizationId].managerId === actorId || c.status === 'offered' && c.employeeId === null),
    requests: economy.requests.filter(r => r.actorId === actorId || r.organizationId && economy.companies[r.organizationId].managerId === actorId) }
}
export function assertCanMoveCarried(world: SimulationSnapshot, actorId: string): void {
  if (world.economy?.holdings.some(h => h.storage.kind === 'carried' && h.storage.actorId === actorId && reserved(world.economy!, h.id))) throw new LifeRuleError('携帯品を出品中です。移動前に出品を取り消すか、品物を現地へ保管して出品してください')
}
export function economyInventory(world: SimulationSnapshot, actorId: string, records: EconomyRecord[]) {
  const economy = state(world), values = economy.holdings.filter(h => sameOwner(h.owner, npcOwner(actorId)))
  const ids = new Set(values.flatMap(v => [v.originId, v.lastRecordId]))
  const indexed = new Map(records.map(r => [r.id, r]))
  const pending = [...ids]
  while (pending.length) for (const previous of indexed.get(pending.pop()!)?.previousIds ?? []) if (!ids.has(previous)) { ids.add(previous); pending.push(previous) }
  return { version: 1 as const, npcId: actorId, currency: economy.currency, vitals: economy.vitals[actorId], account: account(economy, npcOwner(actorId)), holdings: values,
    acquisitionRights: economy.catalog.filter(e => e.licensees.some(o => sameOwner(o, npcOwner(actorId)))).map(e => e.item),
    companies: Object.entries(economy.companies).filter(([, c]) => c.managerId === actorId).map(([organizationId]) => ({ organizationId, account: account(economy, companyOwner(organizationId)), holdings: economy.holdings.filter(h => sameOwner(h.owner, companyOwner(organizationId))), acquisitionRights: economy.catalog.filter(e => e.licensees.some(o => sameOwner(o, companyOwner(organizationId)))).map(e => e.item) })),
    employment: economy.employment.filter(c => c.employeeId === actorId),
    catalog: economy.catalog.filter(e => values.some(v => v.itemId === e.item.id)).map(e => e.item),
    provenance: records.filter(r => ids.has(r.id)), experiences: records.filter(r => r.participants.includes(actorId)) }
}
function labor(world: SimulationSnapshot, actorId: string): void {
  const vitals = state(world).vitals[actorId]
  if (vitals.lastWorkTurn === world.turn) throw new LifeRuleError(`このターンは既に勤務・生産しています: ${actorId}/${world.turn}`)
  if (vitals.hp <= ECONOMY_RULES.workHp || vitals.san === 0) throw new LifeRuleError(`勤務にはHP>${ECONOMY_RULES.workHp}かつSAN>0が必要です: ${actorId}/HP=${vitals.hp}/SAN=${vitals.san}`)
  vitals.hp -= ECONOMY_RULES.workHp; vitals.hunger = clamp(vitals.hunger - ECONOMY_RULES.workHunger); vitals.san = clamp(vitals.san - ECONOMY_RULES.workSan); vitals.lastWorkTurn = world.turn
}
function produce(world: SimulationSnapshot, actorId: string, itemId: string, owner: Owner, r: EconomyRecord): void {
  const economy = state(world), entry = item(economy, itemId), primary = entry.item.primary
  if (!primary || !entry.licensees.some(o => sameOwner(o, owner))) throw new LifeRuleError(`一次産品の取得権がありません: ${itemId}/${ownerKey(owner)}`)
  const storage: Storage = { kind: 'facility', facilityId: primary.facilityId }
  access(world, actorId, storage)
  if (primary.toolItemId) {
    const tool = economy.holdings.find(h => h.itemId === primary.toolItemId && (sameOwner(h.owner, owner) || sameOwner(h.owner, npcOwner(actorId))) && h.durability !== null && h.durability > 0 && !reserved(economy, h.id) && (h.storage.kind === 'facility' && h.storage.facilityId === primary.facilityId || h.storage.kind === 'carried' && h.storage.actorId === actorId))
    if (!tool) throw new LifeRuleError(`使用できる道具がありません: ${primary.toolItemId}`)
    r.previousIds.push(tool.lastRecordId); r.holdingIds.push(tool.id); tool.durability!--; tool.lastRecordId = r.id
    if (!tool.durability) r.text += ' 道具が破損しました。'
  }
  const values = addHolding(economy, entry.item, owner, storage, primary.yield, r.id)
  r.holdingIds.push(...values.map(v => v.id)); r.text += ` ${entry.item.name} ×${primary.yield}を生産。`
}
export function applyEconomyTool(world: SimulationSnapshot, actorId: string, tool: string, input: unknown): { result: unknown; records: EconomyRecord[] } {
  const economy = state(world)
  alive(world, actorId)
  const records: EconomyRecord[] = []
  const log = (r: EconomyRecord) => { records.push(r); return r }
  switch (tool) {
    case 'requestItem': {
      const v = economyToolSchemas.requestItem.parse(input)
      if (v.organizationId) account(economy, companyOwner(v.organizationId))
      const request: ItemRequest = { ...v, id: unique(), actorId, status: 'queued', reason: null, itemId: null }
      economy.requests.push(request); log(record(world, actorId, 'request', `品物「${v.name}」を申請しました`))
      return { result: { request }, records }
    }
    case 'acquireItem': {
      const v = economyToolSchemas.acquireItem.parse(input), entry = item(economy, v.itemId)
      authorize(economy, actorId, v.owner); destination(world, actorId, v.owner, v.storage)
      if (!entry.licensees.some(o => sameOwner(o, v.owner)) || entry.item.cost === null) throw new LifeRuleError(`生成費用で取得する権利がありません: ${v.itemId}/${ownerKey(v.owner)}`)
      const amount = checked(entry.item.cost * v.quantity)
      debit(economy, v.owner, amount); account(economy, v.owner).purchases = checked(account(economy, v.owner).purchases + amount)
      const r = log(record(world, actorId, 'acquire', `${entry.item.name} ×${v.quantity}を${amount}${economy.currency}で取得しました`, [v.owner], [], amount))
      const values = addHolding(economy, entry.item, v.owner, v.storage, v.quantity, r.id); r.holdingIds = values.map(h => h.id)
      return { result: { holdings: values, paid: amount }, records }
    }
    case 'moveItem': {
      const v = economyToolSchemas.moveItem.parse(input), h = holding(economy, v.holdingId)
      authorize(economy, actorId, h.owner); access(world, actorId, h.storage); destination(world, actorId, h.owner, v.storage); available(economy, h, v.quantity)
      const r = log(record(world, actorId, 'storage', `${item(economy, h.itemId).item.name} ×${v.quantity}の保管場所を変更しました`, [h.owner], [h]))
      let values: Holding[]
      if (v.quantity === h.quantity) { h.storage = v.storage; h.lastRecordId = r.id; values = [h] }
      else { remove(economy, h, v.quantity); values = addHolding(economy, item(economy, h.itemId).item, h.owner, v.storage, v.quantity, r.id, h.originId, h.individual, h.durability) }
      r.holdingIds = values.map(value => value.id); return { result: { holdings: values }, records }
    }
    case 'useItem': {
      const v = economyToolSchemas.useItem.parse(input), h = holding(economy, v.holdingId), definition = item(economy, h.itemId).item
      authorize(economy, actorId, h.owner); access(world, actorId, h.storage); available(economy, h, 1)
      if (h.durability === 0) throw new LifeRuleError(`破損した品物です: ${h.id}`)
      const r = log(record(world, actorId, 'use', `${definition.name}を使用しました`, [h.owner], [h]))
      if (definition.kind === 'consumable') remove(economy, h, 1)
      if (h.durability !== null) { h.durability--; if (!h.durability) r.text += ' 品物が破損しました。' }
      h.lastRecordId = r.id
      const vitals = economy.vitals[actorId]
      for (const key of ['hp', 'hunger', 'san'] as const) vitals[key] = clamp(vitals[key] + definition.effects[key])
      return { result: { vitals, remaining: h.quantity, durability: h.durability }, records }
    }
    case 'offerItem': {
      const v = economyToolSchemas.offerItem.parse(input), h = holding(economy, v.holdingId)
      authorize(economy, actorId, h.owner); access(world, actorId, h.storage); available(economy, h, v.quantity)
      if (v.targetId) { alive(world, v.targetId); if (v.targetId === actorId) throw new LifeRuleError('自分宛ての出品はできません') }
      const offer = { ...v, id: unique() }; economy.listings.push(offer)
      log(record(world, actorId, 'offer', `${item(economy, h.itemId).item.name} ×${v.quantity}を単価${v.unitPrice}${economy.currency}で出品しました`, [h.owner], [h], 0, v.targetId ? [v.targetId] : []))
      return { result: { offer }, records }
    }
    case 'cancelItemOffer': {
      const v = economyToolSchemas.cancelItemOffer.parse(input), offer = economy.listings.find(l => l.id === v.offerId)
      if (!offer) throw new LifeRuleError(`出品がありません: ${v.offerId}`)
      const h = holding(economy, offer.holdingId); authorize(economy, actorId, h.owner)
      economy.listings = economy.listings.filter(l => l.id !== offer.id)
      log(record(world, actorId, 'cancel', '出品を取り消しました', [h.owner], [h])); return { result: { cancelled: offer.id }, records }
    }
    case 'buyItem': {
      const v = economyToolSchemas.buyItem.parse(input), offer = economy.listings.find(l => l.id === v.offerId)
      if (!offer || offer.quantity < v.quantity || offer.targetId && offer.targetId !== actorId) throw new LifeRuleError(`受諾可能な出品がありません: ${v.offerId}`)
      const h = holding(economy, offer.holdingId), definition = item(economy, h.itemId).item
      authorize(economy, actorId, v.owner); destination(world, actorId, v.owner, v.storage); accessibleOffer(world, actorId, h)
      if (sameOwner(h.owner, v.owner)) throw new LifeRuleError('同じ所有者の売買はできません')
      const amount = checked(offer.unitPrice * v.quantity)
      debit(economy, v.owner, amount); credit(economy, h.owner, amount)
      account(economy, v.owner).purchases = checked(account(economy, v.owner).purchases + amount)
      account(economy, h.owner).sales = checked(account(economy, h.owner).sales + amount)
      const gift = offer.unitPrice === 0
      const r = log(record(world, actorId, gift ? 'gift' : 'purchase', `${definition.name} ×${v.quantity}を${gift ? '贈り物として受け取りました' : `${amount}${economy.currency}で購入しました`}`, [h.owner, v.owner], [h], amount))
      offer.quantity -= v.quantity; if (!offer.quantity) economy.listings = economy.listings.filter(l => l.id !== offer.id)
      const values = addHolding(economy, definition, v.owner, v.storage, v.quantity, r.id, h.originId, gift || h.individual, h.durability)
      remove(economy, h, v.quantity); r.holdingIds.push(...values.map(value => value.id))
      return { result: { holdings: values, paid: amount }, records }
    }
    case 'companyFunds': {
      const v = economyToolSchemas.companyFunds.parse(input), company = companyOwner(v.organizationId), personal = npcOwner(actorId)
      authorize(economy, actorId, company)
      const [from, to] = v.direction === 'deposit' ? [personal, company] : [company, personal]
      debit(economy, from, v.amount); credit(economy, to, v.amount)
      log(record(world, actorId, 'capital', `${v.direction === 'deposit' ? '会社へ出資' : '会社から引き出し'}: ${v.amount}${economy.currency}`, [from, to], [], v.amount))
      return { result: { company: account(economy, company), personal: account(economy, personal) }, records }
    }
    case 'offerEmployment': {
      const v = economyToolSchemas.offerEmployment.parse(input), owner = companyOwner(v.organizationId)
      authorize(economy, actorId, owner)
      if (v.employeeId) alive(world, v.employeeId)
      if (!world.facilities.some(f => f.id === v.facilityId && f.layout)) throw new LifeRuleError(`利用できる職場がありません: ${v.facilityId}`)
      if (v.primaryItemId) { const entry = item(economy, v.primaryItemId); if (entry.item.primary?.facilityId !== v.facilityId || !entry.licensees.some(o => sameOwner(o, owner))) throw new LifeRuleError('会社の生産権と勤務地が一致しません') }
      const contract = { ...v, id: unique(), status: 'offered' as const }; economy.employment.push(contract)
      log(record(world, actorId, 'employmentOffer', `1勤務${v.wage}${economy.currency}の仕事を募集しました。${v.description}`, [owner], [], 0, v.employeeId ? [v.employeeId] : []))
      return { result: { contract }, records }
    }
    case 'acceptEmployment':
    case 'endEmployment': {
      const v = economyToolSchemas[tool].parse(input), contract = economy.employment.find(c => c.id === v.contractId)
      if (!contract) throw new LifeRuleError(`雇用契約がありません: ${v.contractId}`)
      const manager = economy.companies[contract.organizationId].managerId
      if (tool === 'acceptEmployment') {
        if (!manager || manager === actorId || contract.status !== 'offered' || contract.employeeId && contract.employeeId !== actorId) throw new LifeRuleError('自分が受諾できる求人ではありません')
        contract.employeeId = actorId; contract.status = 'active'
      } else {
        if (manager !== actorId && !(contract.status === 'active' && contract.employeeId === actorId)) throw new LifeRuleError('雇用契約を終了する権限がありません')
        economy.employment = economy.employment.filter(c => c.id !== contract.id)
      }
      log(record(world, actorId, 'employment', tool === 'acceptEmployment' ? '雇用契約に同意しました' : '雇用契約を終了しました', [companyOwner(contract.organizationId), npcOwner(actorId)], [], 0, contract.employeeId ? [contract.employeeId] : []))
      return { result: { contract, ended: tool === 'endEmployment' }, records }
    }
    case 'work':
    case 'produceItem': {
      let owner: Owner, primaryItemId: string | null, wage = 0
      if (tool === 'work') {
        const v = economyToolSchemas.work.parse(input), contract = economy.employment.find(c => c.id === v.contractId && c.status === 'active' && c.employeeId === actorId)
        if (!contract || !economy.companies[contract.organizationId].managerId) throw new LifeRuleError('勤務できる雇用契約がありません')
        access(world, actorId, { kind: 'facility', facilityId: contract.facilityId })
        owner = companyOwner(contract.organizationId); primaryItemId = contract.primaryItemId; wage = contract.wage
        debit(economy, owner, wage); credit(economy, npcOwner(actorId), wage)
        account(economy, owner).wages = checked(account(economy, owner).wages + wage)
      } else {
        const v = economyToolSchemas.produceItem.parse(input); owner = v.owner; primaryItemId = v.itemId; authorize(economy, actorId, owner)
      }
      labor(world, actorId)
      const r = log(record(world, actorId, 'work', tool === 'work' ? `勤務して${wage}${economy.currency}の給与を受け取りました。` : '一次産業で働きました。', [owner, npcOwner(actorId)], [], wage))
      if (primaryItemId) produce(world, actorId, primaryItemId, owner, r)
      return { result: { wage, vitals: economy.vitals[actorId], text: r.text }, records }
    }
    case 'exportItem': {
      const v = economyToolSchemas.exportItem.parse(input), h = holding(economy, v.holdingId), definition = item(economy, h.itemId).item
      authorize(economy, actorId, h.owner); access(world, actorId, h.storage); available(economy, h, v.quantity)
      if (!definition.primary) throw new LifeRuleError('町外出荷できるのは一次産品だけです')
      const amount = checked(definition.primary.exportPrice * v.quantity)
      credit(economy, h.owner, amount); account(economy, h.owner).exports = checked(account(economy, h.owner).exports + amount)
      log(record(world, actorId, 'export', `${definition.name} ×${v.quantity}を町外へ出荷し${amount}${economy.currency}を得ました`, [h.owner], [h], amount)); remove(economy, h, v.quantity)
      return { result: { received: amount }, records }
    }
    case 'designateHeir': {
      const v = economyToolSchemas.designateHeir.parse(input)
      if (v.npcId) { alive(world, v.npcId); if (v.npcId === actorId) throw new LifeRuleError('自分を相続先に指定できません') }
      economy.vitals[actorId].heirId = v.npcId
      log(record(world, actorId, 'heir', v.npcId ? `相続先を${person(world, v.npcId).name}に指定しました` : '相続先の指定を解除しました'))
      return { result: { heirId: v.npcId }, records }
    }
    default: throw new LifeRuleError(`未対応の経済Toolです: ${tool}`)
  }
}
export function tickEconomy(world: SimulationSnapshot): EconomyRecord[] {
  const economy = state(world), records: EconomyRecord[] = []
  if (economy.processedTurn === world.turn) return records
  if (economy.processedTurn + 1 !== world.turn) throw new LifeRuleError(`生存状態のターンが不連続です: ${economy.processedTurn}/${world.turn}`)
  economy.processedTurn = world.turn
  for (const actor of world.actors.filter(a => a.activity !== 'dead')) {
    const v = economy.vitals[actor.id]
    v.hunger = clamp(v.hunger - ECONOMY_RULES.hungerPerTurn); v.san = clamp(v.san - ECONOMY_RULES.sanPerTurn)
    if (!v.hunger) { v.hp = clamp(v.hp - ECONOMY_RULES.starvationHp); records.push(record(world, actor.id, 'starvation', `空腹で体調が悪化しました。HP=${v.hp}`)) }
    if (actor.activity === 'sleeping' && v.hp > 0) { v.san = clamp(v.san + ECONOMY_RULES.sleepSan); if (v.hunger) v.hp = clamp(v.hp + ECONOMY_RULES.sleepHp) }
  }
  return records
}
export function inheritEconomy(world: SimulationSnapshot, deadIds: string[]): EconomyRecord[] {
  const economy = state(world), residents = world.lifecycle!.residents, records: EconomyRecord[] = [], dead = new Set(deadIds)
  const eligible = (id: string) => !dead.has(id) && residents.some(r => r.id === id && r.diedTurn === null)
  for (const id of deadIds) {
    const deceased = residents.find(r => r.id === id)!, from = npcOwner(id)
    let heir = economy.vitals[id].heirId
    if (!heir || !eligible(heir)) {
      heir = null
      for (const relation of ['spouse', 'child', 'parent', 'sibling']) {
        const candidates = residents.filter(r => eligible(r.id) && deceased.family.some(f => f.npcId === r.id && f.relation === relation)).sort((a, b) => b.age - a.age || a.id.localeCompare(b.id, 'en'))
        if (candidates.length) { heir = candidates[0].id; break }
      }
    }
    const owned = economy.holdings.filter(h => sameOwner(h.owner, from))
    const home = world.facilities.flatMap(f => f.layout?.homes ?? []).find(h => h.householdId === deceased.householdId)
    if (owned.some(h => h.storage.kind === 'carried') && !home) throw new LifeRuleError(`故人の保管先となる家がありません: ${id}`)
    const r = record(world, id, 'inheritance', heir ? `${person(world, heir).name}が${deceased.name}の財産を相続しました` : `${deceased.name}の財産を遺産として保管しました`, [from, ...(heir ? [npcOwner(heir)] : [])], owned, account(economy, from).balance)
    for (const h of owned) {
      if (h.storage.kind === 'carried') h.storage = { kind: 'home', homeId: home!.id }
      if (heir) h.owner = npcOwner(heir)
      h.lastRecordId = r.id
      if (!h.individual && h.quantity > 1) {
        const split = addHolding(economy, item(economy, h.itemId).item, h.owner, h.storage, h.quantity, r.id, h.originId, true, h.durability)
        r.holdingIds.push(...split.map(s => s.id)); economy.holdings = economy.holdings.filter(s => s.id !== h.id)
      } else h.individual = true
    }
    const companies = Object.entries(economy.companies).filter(([, c]) => c.managerId === id)
    const oldHoldingIds = new Set(owned.map(h => h.id))
    economy.listings = economy.listings.filter(l => !oldHoldingIds.has(l.holdingId) && l.targetId !== id && !companies.some(([companyId]) => sameOwner(holding(economy, l.holdingId).owner, companyOwner(companyId))))
    economy.employment = economy.employment.filter(c => c.employeeId !== id && !(c.status === 'offered' && companies.some(([companyId]) => c.organizationId === companyId)))
    for (const [, company] of companies) company.managerId = heir
    if (heir) {
      const amount = account(economy, from).balance; debit(economy, from, amount); credit(economy, npcOwner(heir), amount)
      for (const entry of economy.catalog) { entry.licensees = entry.licensees.map(o => sameOwner(o, from) ? npcOwner(heir!) : o); entry.licensees = entry.licensees.filter((o, i, all) => all.findIndex(v => sameOwner(v, o)) === i) }
    }
    for (const request of economy.requests.filter(q => q.actorId === id && q.status === 'queued')) { request.status = 'rejected'; request.reason = '申請者が死亡しました' }
    economy.vitals[id].hp = 0; records.push(r)
  }
  return records
}
