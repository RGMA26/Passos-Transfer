import { useEffect, useState } from 'react'
import { applyUpdate, onUpdateReady } from '../lib/swUpdate'

/** Aviso de versão nova do app, com botão para atualizar na hora. */
export default function UpdateBanner() {
  const [ready, setReady] = useState(false)
  useEffect(() => onUpdateReady(setReady), [])
  if (!ready) return null
  return (
    <div className="update-banner" role="status">
      <span>Nova versão do app disponível.</span>
      <button type="button" onClick={applyUpdate}>
        Atualizar agora
      </button>
    </div>
  )
}
