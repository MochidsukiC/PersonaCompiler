import { useEffect, useState } from 'react'
import type { SimulationSnapshot } from '../../core/life-contracts'
import { updateSpeech, type SpeechBubble as Speech, type SpeechState } from './world-presentation'
import './world.css'

export function useSpeechBubbles(runId: string, simulation?: SimulationSnapshot): Speech[] {
  const events = simulation?.events
  const [state, setState] = useState<SpeechState>(() => updateSpeech(null, runId, events ?? [], Date.now()))
  useEffect(() => {
    setState(previous => updateSpeech(previous, runId, events ?? [], Date.now()))
  }, [runId, events])
  useEffect(() => {
    if (!state.bubbles.length) return
    const delay = Math.max(0, Math.min(...state.bubbles.map(b => b.expiresAt)) - Date.now())
    const timer = window.setTimeout(() => setState(previous => ({ ...previous, bubbles: previous.bubbles.filter(b => b.expiresAt > Date.now()) })), delay)
    return () => window.clearTimeout(timer)
  }, [state])
  return state.runId === runId ? state.bubbles : []
}

export function SpeechBubble({ speech, name, onSelect }: { speech: Speech; name: string; onSelect: () => void }) {
  return <button className="speech-bubble nodrag nopan" data-testid="speech-bubble" data-actor-id={speech.actorId} title={`${name}: ${speech.text}`} aria-label={`${name}の発言: ${speech.text}`} onClick={event => { event.stopPropagation(); onSelect() }}>
    <strong>{name}</strong><span>{speech.text}</span>
  </button>
}
