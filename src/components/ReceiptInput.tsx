import { useEffect, useRef, useState } from 'react'
import { compressImage } from '../lib/photos'

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024
export const MSG_RECEIPT_TYPE = 'Envie JPG, PNG ou PDF de até 10 MB'

interface Props {
  label: string
  onChange: (blob: Blob | null) => void
  /** Arquivo já escolhido (ex.: recebido pelo "Compartilhar" do celular). */
  initialFile?: File | null
}

type Picked = { kind: 'image'; url: string } | { kind: 'pdf'; name: string }

/** Comprovante: foto (comprimida) ou PDF (enviado como está), até 10 MB. */
export default function ReceiptInput({ label, onChange, initialFile }: Props) {
  const [picked, setPicked] = useState<Picked | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(
    () => () => {
      if (picked?.kind === 'image') URL.revokeObjectURL(picked.url)
    },
    [picked],
  )

  async function pick(file: File | undefined | null) {
    setError('')
    const emit = onChangeRef.current
    if (!file) {
      setPicked(null)
      emit(null)
      return
    }
    const pdf = file.type === 'application/pdf'
    if ((!pdf && !file.type.startsWith('image/')) || file.size > MAX_RECEIPT_BYTES) {
      setPicked(null)
      emit(null)
      setError(MSG_RECEIPT_TYPE)
      return
    }
    if (pdf) {
      setPicked({ kind: 'pdf', name: file.name })
      emit(file)
      return
    }
    setBusy(true)
    try {
      const blob = await compressImage(file)
      setPicked({ kind: 'image', url: URL.createObjectURL(blob) })
      emit(blob)
    } catch {
      setPicked(null)
      emit(null)
      setError('Não foi possível usar esta foto. Tente outra.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (initialFile) void pick(initialFile)
    // só o arquivo inicial; escolhas seguintes vêm do campo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile])

  // pré-visualização fora do <label> para não entrar no nome acessível do campo
  return (
    <>
      <label className="field">
        {label}
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </label>
      {busy && <small>Comprimindo...</small>}
      {picked?.kind === 'image' && <img src={picked.url} alt="Pré-visualização" width={96} />}
      {picked?.kind === 'pdf' && (
        <span className="receipt-pdf">
          <span className="badge">PDF</span> <span>{picked.name}</span>
        </span>
      )}
      {error && <small className="error" role="alert">{error}</small>}
    </>
  )
}
