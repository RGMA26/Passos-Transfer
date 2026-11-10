import type { Pendency } from '../lib/api'

/** Destino de cada pendência: conferência (âncora do item) ou quinzenas do motorista. */
export function pendencyPath(p: Pick<Pendency, 'item_type' | 'item_id' | 'driver_id'>): string {
  if (p.item_type === 'period') return `/admin/quinzenas?motorista=${p.driver_id}`
  // 🟠 Transfer em andamento ainda não está na Conferência: corrige-se pela lista de Transfers
  if (p.item_type === 'transfer_in_progress') return '/admin/transfers'
  return `/admin/conferencia#item-${p.item_id}`
}
