import { describe, it, expect, beforeEach } from 'vitest'
import { clearSharedFile, peekSharedFile, saveSharedFile } from './share'

beforeEach(() => clearSharedFile())

describe('arquivo compartilhado', () => {
  it('sem arquivo devolve null', async () => {
    expect(await peekSharedFile()).toBeNull()
  })

  it('guarda, lê sem apagar e limpa', async () => {
    await saveSharedFile(new File(['%PDF'], 'nota.pdf', { type: 'application/pdf' }))
    const f = await peekSharedFile()
    expect(f?.name).toBe('nota.pdf')
    expect(f?.type).toBe('application/pdf')
    expect((await peekSharedFile())?.name).toBe('nota.pdf')
    await clearSharedFile()
    expect(await peekSharedFile()).toBeNull()
  })
})
