export type Signal = 'red' | 'yellow' | null | undefined

/** Sinal de prazo da quinzena: 🔴 terminada sem fechamento, 🟡 termina em até 5 dias, selo "Pausado". */
export default function PeriodSignal({ signal, paused }: { signal: Signal; paused?: boolean }) {
  return (
    <>
      {signal === 'red' && (
        <span role="img" aria-label="Quinzena terminada sem fechamento" title="Quinzena terminada sem fechamento">
          🔴
        </span>
      )}
      {signal === 'yellow' && (
        <span role="img" aria-label="Quinzena termina em até 5 dias" title="Quinzena termina em até 5 dias">
          🟡
        </span>
      )}
      {paused && <span className="badge badge-gray">Pausado</span>}
    </>
  )
}
