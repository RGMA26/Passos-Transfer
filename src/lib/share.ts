import { openDB } from 'idb'

/**
 * Arquivo recebido pelo "Compartilhar" do celular (Web Share Target).
 * O service worker (public/sw-share.js) grava em IndexedDB 'passos-share' / store 'files',
 * chave 'pending', valor { file, name, type, at }; o app lê aqui. Manter os dois em sincronia.
 */
export const SHARE_DB = 'passos-share'
export const SHARE_STORE = 'files'
export const SHARE_KEY = 'pending'

interface Stored {
  file: Blob
  name: string
  type: string
  at: number
}

const dbp = () =>
  openDB(SHARE_DB, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(SHARE_STORE)) db.createObjectStore(SHARE_STORE)
    },
  })

export async function saveSharedFile(file: File): Promise<void> {
  const db = await dbp()
  const v: Stored = { file, name: file.name, type: file.type, at: Date.now() }
  await db.put(SHARE_STORE, v, SHARE_KEY)
}

/** Arquivo pendente (sem apagar), ou null. */
export async function peekSharedFile(): Promise<File | null> {
  try {
    const db = await dbp()
    const v = (await db.get(SHARE_STORE, SHARE_KEY)) as Stored | undefined
    if (!v?.file) return null
    return v.file instanceof File ? v.file : new File([v.file], v.name, { type: v.type || v.file.type })
  } catch {
    return null
  }
}

export async function clearSharedFile(): Promise<void> {
  try {
    const db = await dbp()
    await db.delete(SHARE_STORE, SHARE_KEY)
  } catch {
    /* armazenamento indisponível */
  }
}
