export function loginToEmail(login: string): string {
  const v = login.trim().toLowerCase()
  return v.includes('@') ? v : `${v}@login.passostransfer.app`
}
