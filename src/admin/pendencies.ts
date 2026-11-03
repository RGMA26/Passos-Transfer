import type { Pendency } from '../lib/api'

/** Destino de cada pendência: conferência (âncora do item) ou quinzenas do motorista. */
export function pendencyPath(p: Pick<Pendency, 'item_type' | 'item_id' | 'driver_id'>): string {
  if (p.item_type === 'period') return `/admin/quinzenas?motorista=${p.driver_id}`
  return `/admin/conferencia#item-${p.item_id}`
}
