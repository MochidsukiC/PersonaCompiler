import { useEffect, useState } from 'react'
import { compactDirectionSettings, describeDirectionSettings, intensityOptions, modeLabels, modeOptions, profileLabels, profileOptions, resolveDirectionSettings, tierOptions, updateDirectionOverride, type DialogueRuntimeSettings, type DirectionOverride, type DirectionSettings, type NpcDirectionOption, type RegionDirectionOption } from './direction-settings'

interface Props {
  settings?: DirectionSettings
  compatibilityDefaults: DialogueRuntimeSettings
  regions: RegionDirectionOption[]
  npcs: NpcDirectionOption[]
  busy: boolean
  disabledReason?: string | null
  onSave: (settings: DirectionSettings, expectedRevision: number) => Promise<void>
}
type Field = keyof DialogueRuntimeSettings

export function DirectionSettingsPanel({ settings, compatibilityDefaults, regions, npcs, busy, disabledReason, onSave }: Props) {
  const serialized = JSON.stringify(settings)
  const [draft, setDraft] = useState<DirectionSettings | undefined>(settings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setDraft(settings); setError(null) }, [serialized])
  if (!settings || !draft) return <details className="backend-section direction-settings" data-testid="direction-settings"><summary>会話演出設定</summary><p>未設定（従来動作）です。対応するバックエンドではワールド・地域・NPC別に編集できます。</p></details>

  const changed = JSON.stringify(compactDirectionSettings(draft)) !== JSON.stringify(compactDirectionSettings(settings))
  const save = async () => {
    setSaving(true); setError(null)
    try { await onSave(compactDirectionSettings(draft), settings.revision) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }
  const setWorld = (field: Field, value: DialogueRuntimeSettings[Field] | undefined) => setDraft(current => current && ({
    ...current,
    world: { ...current.world, [field]: value ?? compatibilityDefaults[field] } as DialogueRuntimeSettings
  }))
  const setRegion = (id: string, field: Field, value: DialogueRuntimeSettings[Field] | undefined) => setDraft(current => current && ({ ...current, regions: { ...current.regions, [id]: updateDirectionOverride(current.regions[id] ?? {}, field, value) } }))
  const setNpc = (id: string, field: Field, value: DialogueRuntimeSettings[Field] | undefined) => setDraft(current => current && ({ ...current, npcs: { ...current.npcs, [id]: updateDirectionOverride(current.npcs[id] ?? {}, field, value) } }))

  return <details className="backend-section direction-settings" data-testid="direction-settings" open><summary>会話演出設定 · revision {settings.revision}</summary><p>NPC個別設定が地域設定より優先され、地域設定がワールド設定より優先されます。「継承」は上位設定を使用します。</p>{disabledReason && <p className="direction-lock-note">{disabledReason}</p>}<fieldset disabled={busy || saving || !!disabledReason}>
    <h4>ワールド既定値</h4><DirectionFields prefix="ワールド" value={draft.world} inherited={compatibilityDefaults} allowInherit={false} onChange={setWorld} />
    <details className="direction-scope"><summary>地域別 override <small>{Object.keys(draft.regions).length}件</small></summary>{regions.length === 0 ? <p>地域は仕様確定後に表示されます。</p> : regions.map(region => {
      const inherited = resolveDirectionSettings({ ...draft, regions: { ...draft.regions, [region.id]: {} } }, compatibilityDefaults, region.id)
      const effective = resolveDirectionSettings(draft, compatibilityDefaults, region.id)
      return <div className="direction-card" key={region.id}><div><strong>{region.name}</strong><small>{describeDirectionSettings(effective)}</small></div><DirectionFields prefix={`地域 ${region.name}`} value={draft.regions[region.id] ?? {}} inherited={inherited} onChange={(field, value) => setRegion(region.id, field, value)} /></div>
    })}</details>
    <details className="direction-scope"><summary>NPC個別 override <small>{Object.keys(draft.npcs).length}件</small></summary>{npcs.length === 0 ? <p>NPCは人口生成後にここで編集・確認できます。</p> : npcs.map(npc => {
      const withoutNpc = { ...draft, npcs: { ...draft.npcs, [npc.id]: {} } }
      const inherited = resolveDirectionSettings(withoutNpc, compatibilityDefaults, npc.regionId, npc.id)
      const effective = resolveDirectionSettings(draft, compatibilityDefaults, npc.regionId, npc.id)
      return <div className="direction-card" key={npc.id}><div><strong>{npc.name}</strong><small>{describeDirectionSettings(effective)}</small></div><DirectionFields prefix={`NPC ${npc.name}`} value={draft.npcs[npc.id] ?? {}} inherited={inherited} onChange={(field, value) => setNpc(npc.id, field, value)} /></div>
    })}</details>
    {error && <p role="alert">{error}</p>}<div className="backend-actions"><button className="button primary" type="button" disabled={!changed || busy || saving} onClick={() => void save()}>{saving ? '保存中…' : '会話演出設定を保存'}</button>{changed && <button className="button" type="button" onClick={() => setDraft(settings)}>変更を破棄</button>}</div>
  </fieldset></details>
}

function DirectionFields({ prefix, value, inherited, allowInherit = true, onChange }: { prefix: string; value: DirectionOverride; inherited: DialogueRuntimeSettings; allowInherit?: boolean; onChange: (field: Field, value: DialogueRuntimeSettings[Field] | undefined) => void }) {
  return <div className="direction-grid" title={`継承元: ${describeDirectionSettings(inherited)}`}>
    <Select label={`${prefix} Tier`} value={value.tier} inherited={`Tier ${inherited.tier}`} allowInherit={allowInherit} options={tierOptions.map(item => ({ value: String(item), label: `Tier ${item}` }))} parse={raw => Number(raw) as DialogueRuntimeSettings['tier']} onChange={next => onChange('tier', next)} />
    <Select label={`${prefix} profile`} value={value.directionProfile} inherited={profileLabels[inherited.directionProfile]} allowInherit={allowInherit} options={profileOptions.map(item => ({ value: item, label: profileLabels[item] }))} parse={raw => raw as DialogueRuntimeSettings['directionProfile']} onChange={next => onChange('directionProfile', next)} />
    <Select label={`${prefix} intensity`} value={value.expressionIntensity} inherited={`強度 ${inherited.expressionIntensity}`} allowInherit={allowInherit} options={intensityOptions.map(item => ({ value: String(item), label: `強度 ${item}` }))} parse={raw => Number(raw) as DialogueRuntimeSettings['expressionIntensity']} onChange={next => onChange('expressionIntensity', next)} />
    <Select label={`${prefix} dialogue mode`} value={value.dialogueMode} inherited={modeLabels[inherited.dialogueMode]} allowInherit={allowInherit} options={modeOptions.map(item => ({ value: item, label: modeLabels[item] }))} parse={raw => raw as DialogueRuntimeSettings['dialogueMode']} onChange={next => onChange('dialogueMode', next)} />
  </div>
}
function Select<T extends string | number>({ label, value, inherited, allowInherit, options, parse, onChange }: { label: string; value: T | undefined; inherited: string; allowInherit: boolean; options: { value: string; label: string }[]; parse: (raw: string) => T; onChange: (value: T | undefined) => void }) {
  return <label>{label}<select aria-label={label} value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value === '' ? undefined : parse(event.target.value))}>{allowInherit && <option value="">継承（{inherited}）</option>}{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
}
