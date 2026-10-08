import type { CollectionAfterChangeHook, PayloadRequest } from 'payload'

import type { Media } from '@/payload-types'

export const notifyUpload = async (doc: Media, req: PayloadRequest) => {
  try {
    // System notifications also run for anonymous public uploads.
    const users = await req.payload.find({
      collection: 'users',
      where: { notifyOnUploads: { equals: true } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
      req,
      select: { email: true },
    })
    const origin = req.payload.config.serverURL
    const mediaURL = origin
      ? `${origin}${req.payload.config.routes.admin}/collections/media/${doc.id}`
      : undefined
    const text = [
      `A new file has been uploaded: ${doc.filename || doc.alt}.`,
      mediaURL && `View upload: ${mediaURL}`,
    ]
      .filter(Boolean)
      .join('\n')

    await Promise.all(
      users.docs.map(async (user) => {
        try {
          await req.payload.sendEmail({
            to: user.email,
            subject: 'New upload — Evergreen Dam',
            text,
          })
        } catch (error) {
          req.payload.logger.error({
            err: error,
            mediaID: doc.id,
            userID: user.id,
            msg: 'Upload notification email failed',
          })
        }
      }),
    )
  } catch (error) {
    req.payload.logger.error({
      err: error,
      mediaID: doc.id,
      msg: 'Upload notification recipients could not be loaded',
    })
  }
}

export const notifyOnMediaCreate: CollectionAfterChangeHook<Media> = async ({
  doc,
  operation,
  req,
  context,
}) => {
  if (operation === 'create' && !context.skipUploadNotification) {
    await notifyUpload(doc, req)
  }
  return doc
}
