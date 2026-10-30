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
