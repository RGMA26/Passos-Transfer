import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MoneyInput from './MoneyInput'

describe('MoneyInput', () => {
  it('mostra o valor formatado quando o texto é válido', async () => {
    const onChange = vi.fn()
    render(<MoneyInput label="Valor" onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Valor'), '1.200')
    expect(onChange).toHaveBeenLastCalledWith(1200)
    expect(screen.getByText(/^R\$\s1\.200,00$/)).toBeInTheDocument()
    // o eco não altera o nome acessível do campo
    expect(screen.getByLabelText('Valor')).toHaveValue('1.200')
  })

  it('sem eco para texto inválido', async () => {
    render(<MoneyInput label="Valor" onChange={() => {}} />)
    await userEvent.type(screen.getByLabelText('Valor'), 'abc')
    expect(screen.queryByText(/R\$/)).toBeNull()
  })
})
