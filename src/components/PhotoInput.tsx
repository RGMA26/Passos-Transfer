import { useEffect, useState } from 'react'
import { compressImage } from '../lib/photos'

interface Props {
  label: string
  required?: boolean
  onChange: (blob: Blob | null) => void
}

export default function PhotoInput({ label, required, onChange }: Props) {
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  async function pick(file: File | undefined) {
    setError('')
    if (!file) {
      setPreview(null)
      onChange(null)
      return
    }
    setBusy(true)
    try {
      const blob = await compressImage(file)
      setPreview(URL.createObjectURL(blob))
      onChange(blob)
    } catch {
      setPreview(null)
      onChange(null)
      setError('Não foi possível usar esta foto. Tente outra.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <label className="field">
      {label}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        required={required && !preview}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {busy && <small>Comprimindo...</small>}
      {preview && <img src={preview} alt="Pré-visualização" width={96} />}
      {error && <small className="error" role="alert">{error}</small>}
    </label>
  )
}
