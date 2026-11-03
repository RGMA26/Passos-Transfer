import type { MonthlyBalance } from '../lib/api'

export function balance(over: Partial<MonthlyBalance> = {}): MonthlyBalance {
  return {
    month: '2026-11-01',
    estimated: false,
    result: {
      revenue: { uber: 5000, transfer: 2000, blablacar: 500, total: 7500 },
      owed: {
        total: 3000,
        uber_share: 2500,
        transfer_share: 700,
        fuel_reimbursement: 300,
        transfer_fuel: 100,
        expense_reimbursement: 80,
        off_duty_discount: 40,
        adjustments: -140,
        by_driver: [
          { driver_id: 'd1', name: 'Maria Souza', total: 1800 },
          { driver_id: 'd2', name: 'João Lima', total: 1200 },
        ],
      },
      car_expenses: {
        total: 1250,
        by_kind: { maintenance: 500, insurance: 250, tax: 0, other: 500 },
        items: [
          { expense_id: 'e1', car_id: 'c1', plate: 'ABC1D23', model: 'Corolla', kind: 'insurance', description: 'Seguro anual', mode: 'installments', installment_no: 2, installments: 3, amount: 250 },
          { expense_id: 'e2', car_id: 'c1', plate: 'ABC1D23', model: 'Corolla', kind: 'other', description: 'Rastreador', mode: 'recurring', installment_no: null, installments: null, amount: 500 },
          { expense_id: 'e3', car_id: 'c2', plate: 'XYZ9K88', model: 'Onix', kind: 'maintenance', description: null, mode: 'single', installment_no: null, installments: null, amount: 500 },
        ],
      },
      company_result: 3250,
      previous_company_result: 2000,
      diff: 1250,
      diff_pct: 62.5,
    },
    cash: {
      total: 900,
      items: [
        { statement_id: 's1', driver_id: 'd1', name: 'Maria Souza', period_start: '2026-10-16', period_end: '2026-10-31', total: 900, paid_at: '2026-11-03', payment_method: 'Pix', has_payment_proof: true, has_signed_receipt: false },
      ],
    },
    payable: {
      total: 700,
      items: [{ driver_id: 'd2', name: 'João Lima', closed_unpaid: 500, open_estimate: 200 }],
    },
    off_km_ranking: {
      by_driver: [{ driver_id: 'd1', name: 'Maria Souza', km_off: 77 }],
      by_car: [{ car_id: 'c1', plate: 'ABC1D23', model: 'Corolla', km_off: 77 }],
    },
    ...over,
  }
}
