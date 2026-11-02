import { useEffect } from 'react'
import type { Profile } from '../lib/types'

/** Mock de PhotoInput para testes: sem canvas/URL.createObjectURL do jsdom. */
export function FakePhotoInput({
  label,
  onChange,
}: {
  label: string
  onChange: (b: Blob | null) => void
}) {
  return (
    <label>
      {label}
      <input
        type="file"
        onChange={(e) => onChange(e.target.files?.[0] ? new Blob(['x']) : null)}
      />
    </label>
  )
}

/** Mock de ReceiptInput: como FakePhotoInput, e o arquivo inicial já vem anexado. */
export function FakeReceiptInput({
  label,
  onChange,
  initialFile,
}: {
  label: string
  onChange: (b: Blob | null) => void
  initialFile?: File | null
}) {
  useEffect(() => {
    if (initialFile) onChange(initialFile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile])
  return (
    <>
      <FakePhotoInput label={label} onChange={onChange} />
      {initialFile && <span>{`Anexado: ${initialFile.name}`}</span>}
    </>
  )
}

export const photoFile = () => new File(['x'], 'p.jpg', { type: 'image/jpeg' })

export function makeProfile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'u1',
    driver_type: 'company_car',
    current_car_id: 'c1',
    role: 'driver',
    active: true,
    ...over,
  } as Profile
}
