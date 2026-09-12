import type { AgentDescriptor } from '../../shared/contracts'

export const roleLabels: Record<AgentDescriptor['role'], string> = {
  parent: '親エージェント', npc: '住民', observer: '観測エージェント', facility: '施設エージェント'
}

export const agentStatusLabels: Record<AgentDescriptor['status'], string> = {
  running: 'Running', idle: 'Idle', interrupted: '中断', ended: '終了'
}
