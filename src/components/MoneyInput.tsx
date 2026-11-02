import { useState } from 'react'
import { formatBRL, parseBRL } from '../lib/money'

interface Props {
  label: string
  onChange: (value: number | null) => void
  required?: boolean
  /** Aceita um "-" inicial (ex.: correção de ajuste). */
  allowNegative?: boolean
  /** Texto inicial (ex.: edição de um lançamento). */
  initial?: string
}

function parse(text: string, allowNegative?: boolean): number | null {
  const v = text.trim()
  if (allowNegative && v.startsWith('-')) {
    const n = parseBRL(v.slice(1))
    return n === null ? null : -n
  }
  return parseBRL(v)
}

export default function MoneyInput({ label, onChange, required, allowNegative, initial = '' }: Props) {
  const [text, setText] = useState(initial)
  const value = parse(text, allowNegative)
  // o eco fica fora do <label> para não entrar no nome acessível do campo
  return (
    <>
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
            onChange(parse(e.target.value, allowNegative))
          }}
        />
      </label>
      {value !== null && (
        <small className="hint money-echo" aria-live="polite">
          {value < 0 ? `− ${formatBRL(-value)}` : formatBRL(value)}
        </small>
      )}
    </>
  )
}
