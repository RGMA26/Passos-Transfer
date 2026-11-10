import { odometerEcho } from '../lib/odometer'

/** Campo de odômetro (só inteiro) com a leitura formatada embaixo ("10.102.500 km"). */
export default function OdometerField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const echo = odometerEcho(value)
  return (
    <>
      <label className="field">
        {label}
        <input inputMode="numeric" pattern="[0-9]*" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      {echo && (
        <p className="hint odometer-echo" aria-live="polite">
          {echo}
        </p>
      )}
    </>
  )
}
