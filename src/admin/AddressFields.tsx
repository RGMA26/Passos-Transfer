export interface AddressValue {
  street: string
  district: string
  city: string
  state: string
  zip: string
  ref: string
}

export const EMPTY_ADDRESS: AddressValue = { street: '', district: '', city: '', state: '', zip: '', ref: '' }

/** Os quatro primeiros campos são obrigatórios; CEP e referência não. */
export const isAddressComplete = (a: AddressValue) =>
  [a.street, a.district, a.city, a.state].every((v) => v.trim() !== '')

interface Props {
  legend: string
  value: AddressValue
  onChange: (next: AddressValue) => void
}

/** Endereço em campos (rua e número, bairro, cidade, UF, CEP e referência opcionais). */
export default function AddressFields({ legend, value, onChange }: Props) {
  const set = (k: keyof AddressValue) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: k === 'state' ? e.target.value.toUpperCase() : e.target.value })
  return (
    <fieldset className="panel">
      <legend>{legend}</legend>
      <label className="field">
        Rua e número
        <input value={value.street} onChange={set('street')} autoComplete="off" />
      </label>
      <label className="field">
        Bairro
        <input value={value.district} onChange={set('district')} autoComplete="off" />
      </label>
      <label className="field">
        Cidade
        <input value={value.city} onChange={set('city')} autoComplete="off" />
      </label>
      <label className="field">
        UF
        <input value={value.state} onChange={set('state')} maxLength={2} autoComplete="off" />
      </label>
      <label className="field">
        CEP (opcional)
        <input value={value.zip} onChange={set('zip')} inputMode="numeric" autoComplete="off" />
      </label>
      <label className="field">
        Referência (opcional)
        <input value={value.ref} onChange={set('ref')} autoComplete="off" />
      </label>
    </fieldset>
  )
}
