# Quest game adapter contract

The game is the only authority that may change quest stages. The editor changes definitions only.

Send commands through `backendCommand` with `source: "game_adapter"`. Every command must use a stable, unique `eventId`; replaying the same ID is safe and returns `duplicate`.

## Trigger dialogue

```json
{
  "type": "questEvent",
  "source": "game_adapter",
  "eventId": "interaction-000123",
  "questId": "lost-package",
  "action": "trigger",
  "trigger": "player_interact"
}
```

Read `questEventResult` from the returned backend snapshot. Important statuses are `spoken`, `queued`, `pending_location`, `already_active`, `ignored`, `expired`, and `duplicate`. `spoken` includes a `completionEvent`; generated speech produces the same event asynchronously in `questSettings.completionEvents`.

## Change stage

```json
{
  "type": "questEvent",
  "source": "game_adapter",
  "eventId": "quest-progress-000124",
  "questId": "lost-package",
  "action": "set_stage",
  "stage": "objective_complete"
}
```

Speech never advances a quest automatically. The game consumes the completion event, applies its own gameplay conditions, and then sends a separate stage change.

## Consume a completion event

```json
{
  "type": "questEvent",
  "source": "game_adapter",
  "eventId": "consume-000125",
  "questId": "lost-package",
  "action": "consume_completion",
  "speechEventId": 42
}
```

Consumption is explicit and exactly once. A missing or already-consumed event is an error. Keep the game's own event log as the long-term authority; the Harness retains a bounded recent idempotency window.

## Semi-fixed facts

Each required Fact has an ID, canonical value, paraphrase flag, and evidence terms. The Harness requires both the Fact ID and matching evidence in the actual text. Failed validation permits one retry for that activation event; a second failure emits the configured fixed fallback.

## Location locks

The Harness never teleports an NPC. A mismatched location returns `pending_location`, enqueues a normal movement request, and retains the original deadline across repeated triggers. Passing the deadline expires and cancels the activation.
