import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent, DesktopApi } from '../shared/contracts'

const api: DesktopApi = {
  inspectCharacterPackage: manifestPath => ipcRenderer.invoke('persona:inspect-character-package', manifestPath),
  eventHistory: query => ipcRenderer.invoke('persona:event-history', query),
  devPanel: () => ipcRenderer.invoke('persona:dev-panel'),
  memoryInspection: id => ipcRenderer.invoke('persona:memory-inspection', id),
  memoryDetail: (id, memoryId, revision) => ipcRenderer.invoke('persona:memory-detail', id, memoryId, revision),
  backendStatus: () => ipcRenderer.invoke('persona:backend-status'),
  backendCommand: command => ipcRenderer.invoke('persona:backend-command', command),
  snapshot: () => ipcRenderer.invoke('persona:snapshot'),
  prepare: input => ipcRenderer.invoke('persona:prepare', input),
  startSimulation: (step = false) => ipcRenderer.invoke('persona:start-simulation', step),
  pause: () => ipcRenderer.invoke('persona:pause'),
  saveNow: () => ipcRenderer.invoke('persona:save-now'),
  resume: () => ipcRenderer.invoke('persona:resume'),
  newRun: () => ipcRenderer.invoke('persona:new-run'),
  preview: path => ipcRenderer.invoke('persona:preview', path),
  openExternal: path => ipcRenderer.invoke('persona:open-external', path),
  reveal: path => ipcRenderer.invoke('persona:reveal', path),
  terminalSnapshot: id => ipcRenderer.invoke('persona:terminal-snapshot', id),
  conversation: (id, cursor) => ipcRenderer.invoke('persona:conversation', id, cursor),
  terminalInput: (id, data) => ipcRenderer.invoke('persona:terminal-input', id, data),
  terminalResize: (id, columns, rows) => ipcRenderer.invoke('persona:terminal-resize', id, columns, rows),
  terminalInterrupt: id => ipcRenderer.invoke('persona:terminal-interrupt', id),
  onEvent: listener => {
    const handler = (_event: Electron.IpcRendererEvent, event: AppEvent) => listener(event)
    ipcRenderer.on('persona:event', handler)
    return () => { ipcRenderer.removeListener('persona:event', handler) }
  }
}
contextBridge.exposeInMainWorld('persona', api)
