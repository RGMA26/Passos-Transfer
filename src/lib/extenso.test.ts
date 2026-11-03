import { describe, it, expect } from 'vitest'
import { valorPorExtenso } from './extenso'

describe('valorPorExtenso', () => {
  it.each([
    [1, 'um real'],
    [0.5, 'cinquenta centavos'],
    [0.01, 'um centavo'],
    [213, 'duzentos e treze reais'],
    [100, 'cem reais'],
    [101, 'cento e um reais'],
    [1000, 'mil reais'],
    [1234.56, 'mil duzentos e trinta e quatro reais e cinquenta e seis centavos'],
    [2000, 'dois mil reais'],
    [1000000, 'um milhão de reais'],
    [2500000.5, 'dois milhões e quinhentos mil reais e cinquenta centavos'],
    [0, 'zero real'],
  ])('%s -> %s', (n, txt) => {
    expect(valorPorExtenso(n)).toBe(txt)
  })
})
