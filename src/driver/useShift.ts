import { useCallback, useEffect, useState } from 'react'
import * as api from '../lib/api'
import { listOps, onQueueChange } from '../lib/offline/queue'
import type { QueuedOp } from '../lib/offline/queue'
import type { Ride, Shift } from '../lib/types'

export interface ShiftState {
  id: string
  odometerStart: number
  /** Instante de início (ms) — para comparar com ops pendentes. */
  startedAtMs: number
}

/** Turno aberto = turno aberto no servidor OU start_shift pendente, menos end_shift pendente. */
export function deriveShift(server: Shift | null, ops: QueuedOp[]): ShiftState | null {
  let shift: ShiftState | null = null
  if (server) {
    shift = {
      id: server.id,
      odometerStart: server.odometer_start,
      startedAtMs: Date.parse(server.started_at),
    }
  } else {
    const start = ops.find((o) => o.kind === 'start_shift')
    if (start) {
      shift = {
        id: String(start.payload.id),
        odometerStart: Number(start.payload.odometer),
        startedAtMs: start.createdAt / 1000,
      }
    }
  }
  if (!shift) return null
  const id = shift.id
  if (ops.some((o) => o.kind === 'end_shift' && o.payload.shift_id === id)) return null
  return shift
}

export interface ShiftData {
  loading: boolean
  ops: QueuedOp[]
  shift: ShiftState | null
  serverRides: Ride[]
  refresh: () => Promise<void>
}

export function useShift(userId: string | undefined, enabled = true): ShiftData {
  const [loading, setLoading] = useState(true)
  const [ops, setOps] = useState<QueuedOp[]>([])
  const [server, setServer] = useState<Shift | null>(null)
  const [serverRides, setServerRides] = useState<Ride[]>([])

  const refresh = useCallback(async () => {
    if (!userId || !enabled) return
    setOps(await listOps(userId))
    try {
      const s = await api.getOpenShift(userId)
      setServer(s)
      setServerRides(s ? await api.getShiftRides(s.id) : [])
    } catch {
      // offline: mantém o último estado do servidor
    }
    setLoading(false)
  }, [userId, enabled])

  useEffect(() => {
    if (!userId || !enabled) {
      setLoading(false)
      return
    }
    void refresh()
    return onQueueChange(() => void refresh())
  }, [userId, enabled, refresh])

  return { loading, ops, shift: deriveShift(server, ops), serverRides, refresh }
}
