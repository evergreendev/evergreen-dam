import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import type { Media } from '@/payload-types'
import { notifyOnMediaCreate, notifyUpload } from '@/util/notifyUpload'

const doc = { id: 12, filename: 'photo.jpg', alt: 'Photo' } as Media
const makeRequest = (users = [{ id: 1, email: 'subscriber@example.com' }]) => {
  const payload = {
    config: { serverURL: 'https://example.com', routes: { admin: '/admin' } },
    find: vi.fn().mockResolvedValue({ docs: users }),
    sendEmail: vi.fn().mockResolvedValue(undefined),
    logger: { error: vi.fn() },
  }
  return { payload } as unknown as PayloadRequest & { payload: typeof payload }
}

describe('Upload notifications', () => {
  it('selects all opted-in users and sends individual notifications', async () => {
    const req = makeRequest([
      { id: 1, email: 'one@example.com' },
      { id: 2, email: 'two@example.com' },
    ])
    await notifyUpload(doc, req)
    expect(req.payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { notifyOnUploads: { equals: true } },
        pagination: false,
        req,
      }),
    )
    expect(req.payload.sendEmail).toHaveBeenCalledTimes(2)
    expect(req.payload.sendEmail).toHaveBeenCalledWith({
      to: 'one@example.com',
      subject: 'New upload — Evergreen Dam',
      text: 'A new file has been uploaded: photo.jpg.\nView upload: https://example.com/admin/collections/media/12',
    })
  })

  it('sends nothing when nobody has opted in', async () => {
    const req = makeRequest([])
    await notifyUpload(doc, req)
    expect(req.payload.sendEmail).not.toHaveBeenCalled()
  })

  it('logs delivery failures without failing the upload or other deliveries', async () => {
    const req = makeRequest([
      { id: 1, email: 'one@example.com' },
      { id: 2, email: 'two@example.com' },
    ])
    req.payload.sendEmail.mockRejectedValueOnce(new Error('SMTP unavailable'))
    await expect(notifyUpload(doc, req)).resolves.toBeUndefined()
    expect(req.payload.sendEmail).toHaveBeenCalledTimes(2)
    expect(req.payload.logger.error).toHaveBeenCalled()
  })

  it('skips metadata updates and copies made by the public upload endpoint', async () => {
    const req = makeRequest()
    const args = { doc, req, context: {}, operation: 'update' }
    await notifyOnMediaCreate(args as unknown as Parameters<typeof notifyOnMediaCreate>[0])
    await notifyOnMediaCreate({
      ...args,
      operation: 'create',
      context: { skipUploadNotification: true },
    } as unknown as Parameters<typeof notifyOnMediaCreate>[0])
    expect(req.payload.find).not.toHaveBeenCalled()
    await notifyOnMediaCreate({ ...args, operation: 'create' } as unknown as Parameters<
      typeof notifyOnMediaCreate
    >[0])
    expect(req.payload.sendEmail).toHaveBeenCalledTimes(1)
  })
})
