import { useState } from 'react'
import { parseBRL } from '../lib/money'

interface Props {
  label: string
  onChange: (value: number | null) => void
  required?: boolean
}

export default function MoneyInput({ label, onChange, required }: Props) {
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
          onChange(parseBRL(e.target.value))
        }}
      />
    </label>
  )
}
