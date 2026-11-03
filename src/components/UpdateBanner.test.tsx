import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let notify: ((ready: boolean) => void) | null = null
const applyUpdate = vi.fn()

vi.mock('../lib/swUpdate', () => ({
  onUpdateReady: (l: (ready: boolean) => void) => {
    notify = l
    l(false)
    return () => {
      notify = null
    }
  },
  applyUpdate: () => applyUpdate(),
}))

import UpdateBanner from './UpdateBanner'

describe('UpdateBanner', () => {
  beforeEach(() => {
    applyUpdate.mockClear()
    notify = null
  })

  it('não aparece sem versão nova', () => {
    render(<UpdateBanner />)
    expect(screen.queryByText('Nova versão do app disponível.')).toBeNull()
  })

  it('aparece quando há versão nova e atualiza ao tocar', async () => {
    render(<UpdateBanner />)
    act(() => notify?.(true))
    expect(screen.getByText('Nova versão do app disponível.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }))
    expect(applyUpdate).toHaveBeenCalledTimes(1)
  })
})
