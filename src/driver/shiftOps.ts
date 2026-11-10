import type { QueuedOp } from '../lib/offline/queue'

/** Último start_shift que o servidor recusou (status 'failed'), ou null. */
export function failedStartShift(ops: QueuedOp[]): QueuedOp | null {
  const failed = ops.filter((o) => o.kind === 'start_shift' && o.status === 'failed')
  if (failed.length === 0) return null
  return failed.reduce((a, b) => (b.createdAt >= a.createdAt ? b : a))
}

/** Motivo sem o prefixo "Não enviado: " (para frases como "Seu turno não foi aberto: ..."). */
export function failureReason(op: QueuedOp): string {
  return (op.error ?? 'erro ao enviar').replace(/^Não enviado:\s*/, '')
}
