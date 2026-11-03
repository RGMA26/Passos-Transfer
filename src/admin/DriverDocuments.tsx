import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import * as api from '../lib/api'
import type { AdminDocument } from '../lib/api'

const KIND_LABEL: Record<string, string> = {
  payment_proof: 'Comprovante de pagamento',
  signed_receipt: 'Recibo assinado',
  other: 'Outro',
}
const MSG_LOAD = 'Não foi possível carregar os documentos.'
const MSG_TYPE = 'Envie JPG, PNG ou PDF de até 10 MB'
const MAX = 10 * 1024 * 1024
const OK_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

/** Aba "Documentos" da ficha do motorista: lista, abre (link assinado 10 min), exclui e adiciona. */
export default function DriverDocuments({ driverId }: { driverId: string }) {
  const [docs, setDocs] = useState<AdminDocument[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setDocs(await api.listAdminDocuments({ driverId }))
    } catch {
      setFailed(true)
    }
  }, [driverId])

  useEffect(() => {
    void load()
  }, [load])

  async function open(d: AdminDocument) {
    setError('')
    try {
      window.open(await api.adminDocumentUrl(d.file_path), '_blank', 'noopener')
    } catch {
      setError('Não foi possível abrir o documento')
    }
  }

  async function remove(d: AdminDocument) {
    if (!window.confirm('Excluir este documento?')) return
    setError('')
    try {
      await api.deleteAdminDocument(d)
      await load()
    } catch {
      setError('Não foi possível excluir o documento')
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!description.trim()) return setError('Descreva o documento')
    if (!file || !OK_TYPES.includes(file.type) || file.size > MAX) return setError(MSG_TYPE)
    setBusy(true)
    try {
      await api.uploadAdminDocument({ driverId, kind: 'other', description, file })
      setDescription('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      await load()
    } catch (err) {
      setError((err as { code?: string }).code === 'INVALID_FILE' ? MSG_TYPE : 'Não foi possível enviar o documento')
    } finally {
      setBusy(false)
    }
  }

  if (failed) {
    return (
      <div>
        <p className="error">{MSG_LOAD}</p>
        <button type="button" onClick={() => void load()}>
          Tentar novamente
        </button>
      </div>
    )
  }
  if (!docs) return <p className="loading">Carregando…</p>

  return (
    <div>
      {docs.length === 0 && <p className="hint">Nenhum documento.</p>}
      <ul className="list">
        {docs.map((d) => (
          <li key={d.id}>
            <span>
              {`${fmtDate(d.created_at)} · ${KIND_LABEL[d.kind] ?? d.kind}${d.description ? ` · ${d.description}` : ''}`}
            </span>{' '}
            <button type="button" onClick={() => void open(d)}>
              Abrir
            </button>{' '}
            <button type="button" onClick={() => void remove(d)}>
              Excluir
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <strong>Adicionar documento</strong>
        <label className="field">
          Descrição do documento
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          Arquivo
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          Enviar documento
        </button>
      </form>
    </div>
  )
}
