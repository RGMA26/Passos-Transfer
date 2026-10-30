import { useState } from 'react'
import { parseBRL } from '../lib/money'

interface Props {
  label: string
  onChange: (value: number | null) => void
  required?: boolean
  /** Aceita um "-" inicial (ex.: correção de ajuste). */
  allowNegative?: boolean
}

export default function MoneyInput({ label, onChange, required, allowNegative }: Props) {
  const [text, setText] = useState('')
  return (
    <label className="field">
      {label}
      <input
        type="text"
        inputMode="decimal"
        placeholder="0,00"
        required={required}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = e.target.value.trim()
          if (allowNegative && v.startsWith('-')) {
            const n = parseBRL(v.slice(1))
            onChange(n === null ? null : -n)
          } else onChange(parseBRL(v))
        }}
      />
    </label>
  )
}
