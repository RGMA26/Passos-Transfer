import { resetDb } from './global-setup'

/** Depois do E2E o banco volta ao seed (os testes pgTAP de `npx supabase test db` partem dele). */
export default function globalTeardown() {
  resetDb()
}
