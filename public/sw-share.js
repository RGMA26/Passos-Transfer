/* Web Share Target (Android): importado pelo service worker gerado (workbox.importScripts).
 * Recebe o POST /share-target do "Compartilhar", guarda o arquivo no IndexedDB e abre
 * /m/compartilhar. Mesmo formato de src/lib/share.ts:
 * banco 'passos-share' v1, store 'files', chave 'pending', valor { file, name, type, at }. */
const SHARE_DB = 'passos-share'
const SHARE_STORE = 'files'
const SHARE_KEY = 'pending'

function openShareDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SHARE_STORE)) req.result.createObjectStore(SHARE_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveSharedFile(file) {
  const db = await openShareDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, 'readwrite')
    tx.objectStore(SHARE_STORE).put(
      { file, name: file.name || 'comprovante', type: file.type, at: Date.now() },
      SHARE_KEY,
    )
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function handleShare(request) {
  try {
    const form = await request.formData()
    const file = form.getAll('file').find((f) => f && typeof f === 'object' && 'size' in f)
    if (file) await saveSharedFile(file)
  } catch (e) {
    // sem arquivo legível: a página avisa "Nenhum arquivo recebido."
    console.error('share-target', e)
  }
  return Response.redirect('/m/compartilhar', 303)
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share-target') {
    event.respondWith(handleShare(event.request))
  }
})
