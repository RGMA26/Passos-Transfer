import { describe, it, expect, vi, beforeEach } from 'vitest'

const upload = vi.fn()
vi.mock('./supabase', () => ({
  supabase: { storage: { from: () => ({ upload: (...a: unknown[]) => upload(...a) }) } },
}))
vi.mock('browser-image-compression', () => ({ default: vi.fn() }))
import { uploadPhoto } from './photos'

beforeEach(() => upload.mockReset().mockResolvedValue({ error: null }))

describe('uploadPhoto', () => {
  it('imagem vai como .jpg image/jpeg', async () => {
    const b = new Blob(['x'], { type: 'image/jpeg' })
    expect(await uploadPhoto(b, 'u1', 'p1')).toBe('u1/p1.jpg')
    expect(upload).toHaveBeenCalledWith('u1/p1.jpg', b, { upsert: true, contentType: 'image/jpeg' })
  })

  it('PDF vai como .pdf application/pdf', async () => {
    const b = new File(['%PDF'], 'nota.pdf', { type: 'application/pdf' })
    expect(await uploadPhoto(b, 'u1', 'p1')).toBe('u1/p1.pdf')
    expect(upload).toHaveBeenCalledWith('u1/p1.pdf', b, { upsert: true, contentType: 'application/pdf' })
  })
})
