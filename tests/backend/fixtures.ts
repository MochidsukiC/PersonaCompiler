import type { ModelInfo, Population, QuestionRound, SpecificationDraft } from '../../src/core/contracts'
import { defaultSettings } from '../../src/core/models'

export const models: ModelInfo[] = ['gpt-5.6-luna', 'gpt-6-astra'].map((model, i) => ({ id: model, model, displayName: model, description: 'fixture', isDefault: i === 0, defaultReasoningEffort: 'medium', inputModalities: ['text', 'image'], supportedReasoningEfforts: ['low', 'medium', 'high'].map(reasoningEffort => ({ reasoningEffort, description: reasoningEffort })) }))
export const settings = defaultSettings(models)
export const round: QuestionRound = { id: 'round-1', questions: [1, 2, 3].map(i => ({ id: `q${i}`, question: `質問${i}`, reason: '仕様を決めます', recommendedOptionId: 'a', options: [{ id: 'a', label: '推奨', description: '推奨案' }, { id: 'b', label: '代替', description: '代替案' }] })) }
export const answers = { roundId: round.id, answers: round.questions.map(q => ({ questionId: q.id, optionId: null, text: '自由回答です' })) }
export const draft: SpecificationDraft = {
  revision: 1,
  specification: {
    town: { name: '試験の町', setting: '小さな町', facilities: [{ id: 'school', name: '学校', type: 'school', description: '町の学校', locationId: 'school', dimensions: { x: 20, y: 20, z: 3 } }, { id: 'office', name: '職場', type: 'workplace', description: '町の職場', locationId: 'office', dimensions: { x: 20, y: 20, z: 3 } }, { id: 'residential', name: '住宅街', type: 'residential', description: '世帯ごとの家', locationId: 'home', dimensions: { x: 30, y: 30, z: 3 } }] },
    population: { count: 5, ageDistribution: [{ min: 0, max: 17, ratio: 0.4 }, { min: 18, max: 90, ratio: 0.6 }], sexRatio: [{ sex: '女性', ratio: 0.5 }, { sex: '男性', ratio: 0.5 }] },
    simulation: { maxTurns: 100, turnsPerDay: 4, endCondition: 'turn_limit' }
  },
  map: { revision: 1, name: '試験の町', bounds: { width: 1000, height: 800 }, areas: [{ id: 'town', name: '町', position: { x: 0, y: 0 }, width: 1000, height: 800, color: '#334455' }], locations: ['home', 'school', 'office'].map((id, i) => ({ id, name: id, kind: id, areaId: 'town', position: { x: 150 + i * 200, y: 200 } })), connections: [{ id: 'road', from: 'home', to: 'school' }] }
}
export const population: Population = { npcs: [5, 17, 30, 40, 60].map((age, i) => ({ id: `npc${i}`, name: `住民${i}`, age, sex: i < 3 ? '女性' : '男性', temperament: '穏やか', physicalAttributes: '', occupation: age < 18 ? null : '会社員', householdId: `house${i}`, locationId: 'home', family: [], birthModelId: models[0].model, modelSelectionReason: '固定設定' })) }
