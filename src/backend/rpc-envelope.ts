import { z } from 'zod'

export const rpcEnvelopeSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(), method: z.string().optional(), params: z.unknown().optional(),
  result: z.unknown().optional(), error: z.object({ code: z.number(), message: z.string() }).passthrough().optional()
}).passthrough().superRefine((message, context) => {
  if (!message.method && (message.id === undefined || Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error'))) {
    context.addIssue({ code: 'custom', message: 'RPC応答にはIDと、resultまたはerrorのどちらか一方が必要です' })
  }
})
