export const MSG_PAUSED = 'Seu cadastro está pausado. Fale com a empresa.'

/** Aviso do motorista pausado (spec §2.4): vê o Extrato, mas não lança nada. */
export default function PausedNotice() {
  return (
    <p className="error" role="status">
      {MSG_PAUSED}
    </p>
  )
}
