import { describe, it, expect } from 'vitest'
import { pendencyPath } from './pendencies'

describe('pendencyPath', () => {
  it('quinzena vai para Quinzenas do motorista', () => {
    expect(pendencyPath({ item_type: 'period', item_id: 'p1', driver_id: 'd1' })).toBe('/admin/quinzenas?motorista=d1')
  })
  it('turno/Transfer concluído vai para a Conferência', () => {
    expect(pendencyPath({ item_type: 'transfer', item_id: 't1', driver_id: 'd1' })).toBe('/admin/conferencia#item-t1')
    expect(pendencyPath({ item_type: 'shift', item_id: 's1', driver_id: 'd1' })).toBe('/admin/conferencia#item-s1')
  })
  it('Transfer em andamento (🟠) vai para a lista de Transfers', () => {
    expect(pendencyPath({ item_type: 'transfer_in_progress', item_id: 't1', driver_id: 'd1' })).toBe('/admin/transfers')
  })
})
