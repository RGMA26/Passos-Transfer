import { describe, expect, it } from 'vitest'
import { loginToEmail } from './loginCode'

describe('loginToEmail', () => {
  it('maps login codes to emails', () => {
    expect(loginToEmail('PASSOS01JOAO')).toBe('passos01joao@login.passostransfer.app')
    expect(loginToEmail(' passos01joao ')).toBe('passos01joao@login.passostransfer.app')
    expect(loginToEmail('admin@passos.com')).toBe('admin@passos.com')
  })
})
