import imageCompression from 'browser-image-compression'
import { supabase } from './supabase'

export async function compressImage(file: File): Promise<Blob> {
  return imageCompression(file, {
    maxWidthOrHeight: 1600,
    maxSizeMB: 0.5,
    fileType: 'image/jpeg',
    // sem worker: a lib baixaria o script do worker de uma CDN (falha offline / CSP)
    useWebWorker: false,
  })
}

/**
 * Idempotente (upsert): reenviar o mesmo photoId sobrescreve o mesmo path.
 * Comprovante em PDF vai como `{driverId}/{photoId}.pdf` (application/pdf), sem compressão.
 */
export async function uploadPhoto(blob: Blob, driverId: string, photoId: string): Promise<string> {
  const pdf = blob.type === 'application/pdf'
  const path = `${driverId}/${photoId}.${pdf ? 'pdf' : 'jpg'}`
  const { error } = await supabase.storage
    .from('photos')
    .upload(path, blob, { upsert: true, contentType: pdf ? 'application/pdf' : 'image/jpeg' })
  if (error) {
    const e = error as { message: string; status?: number; statusCode?: string | number }
    const status = Number(e.status ?? e.statusCode)
    // sem status HTTP = falha de rede (transitória)
    if (!status) throw new TypeError(e.message)
    throw Object.assign(new Error(e.message), { status })
  }
  return path
}
