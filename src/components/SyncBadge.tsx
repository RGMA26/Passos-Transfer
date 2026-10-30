import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { discardOp, listOps, onQueueChange, retryOp } from '../lib/offline/queue'
import type { QueuedOp } from '../lib/offline/queue'

export default function SyncBadge() {
  const [ops, setOps] = useState<QueuedOp[]>([])
  const uid = useAuth().session?.user.id

  useEffect(() => {
    let alive = true
    if (!uid) {
      setOps([])
      return
    }
    const load = () => void listOps(uid).then((o) => alive && setOps(o))
    load()
    const off = onQueueChange(load)
    return () => {
      alive = false
      off()
    }
  }, [uid])

  const pending = ops.filter((o) => o.status === 'pending').length
  const failed = ops.filter((o) => o.status === 'failed')
  if (pending === 0 && failed.length === 0) return null

  return (
    <div className="sync-badge" role="status">
      {pending > 0 && <span>{pending} pendente(s) de envio</span>}
      {failed.length > 0 && <span>{failed.length} com erro</span>}
      {failed.length > 0 && (
        <ul>
          {failed.map((o) => (
            <li key={o.id}>
              {o.error}{' '}
              <button type="button" onClick={() => void retryOp(o.id)}>
                Tentar de novo
              </button>{' '}
              <button type="button" onClick={() => void discardOp(o.id)}>
                Descartar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
