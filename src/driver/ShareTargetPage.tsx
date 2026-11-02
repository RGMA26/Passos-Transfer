import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { peekSharedFile } from '../lib/share'
import type { LaunchKind } from './LaunchTab'

const CHOICES: { kind: LaunchKind; label: string }[] = [
  { kind: 'fueling', label: 'Abastecimento' },
  { kind: 'toll', label: 'Pedágio' },
  { kind: 'parking', label: 'Estacionamento' },
  { kind: 'uber', label: 'Corrida Uber' },
  { kind: 'blablacar', label: 'Corrida BlaBlaCar' },
]

/** /m/compartilhar: arquivo recebido pelo "Compartilhar" do celular → escolher o lançamento. */
export default function ShareTargetPage() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void peekSharedFile().then((f) => alive && setFile(f))
    return () => {
      alive = false
    }
  }, [])

  if (file === undefined) return <p className="loading">Carregando…</p>
  if (!file) {
    return (
      <section>
        <h2>Compartilhar</h2>
        <p className="hint">Nenhum arquivo recebido.</p>
        <Link to="/m/lancar">Ir para Lançar</Link>
      </section>
    )
  }

  return (
    <section>
      <h2>O que é este comprovante?</h2>
      <p className="hint">{file.name}</p>
      <div className="choices">
        {CHOICES.map((c) => (
          <button
            key={c.kind}
            type="button"
            className="big"
            onClick={() => navigate(`/m/lancar?tipo=${c.kind}&compartilhado=1`)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </section>
  )
}
