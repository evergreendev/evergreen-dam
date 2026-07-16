import { readFile } from 'fs/promises'
import path from 'path'
import { addDataAndFileToRequest, type CollectionConfig, type PayloadRequest } from 'payload'

import type { Media as MediaType } from '@/payload-types'
import { createZip } from '@/util/createZip'
import {
  findOrCreateGoogleDriveFolder,
  isGoogleDriveUploadConfigured,
  uploadFileToGoogleDrive,
} from '@/util/googleDrive'

const getStringValues = (...values: unknown[]) => {
  const strings = values.flatMap((value) => {
    if (typeof value === 'string') {
      return [value]
    }

    if (typeof value === 'number') {
      return [String(value)]
    }

    if (Array.isArray(value)) {
      return value
        .filter(
          (item): item is number | string => typeof item === 'number' || typeof item === 'string',
        )
        .map((item) => String(item))
    }

    return []
  })

  return [
    ...new Set(
      strings
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
}

const getPublicationIDs = (values: string[]) => {
  const ids = values.map((value) => Number(value))

  if (ids.some((id) => !Number.isFinite(id))) {
    return null
  }

  return ids
}

const getTrimmedString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const isAccepted = (value: unknown) => value === true || value === 'true' || value === 'on'

const recaptchaAction = process.env.RECAPTCHA_ACTION || 'public_upload'
const recaptchaMinimumScore = Number(process.env.RECAPTCHA_MIN_SCORE || 0.5)
const mediaCreateRetryDelaysMS = [300, 900]

type RecaptchaSiteVerifyResponse = {
  action?: string
  'error-codes'?: string[]
  score?: number
  success: boolean
}

const getRecaptchaToken = (data: PayloadRequest['data']) =>
  getTrimmedString(data?.recaptchaToken ?? data?.['g-recaptcha-response'])

const verifyRecaptcha = async (req: PayloadRequest) => {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY

  if (!secretKey) {
    return {
      message: 'Upload protection is not configured.',
      status: 500,
    }
  }

  const token = getRecaptchaToken(req.data)

  if (!token) {
    return {
      message: 'Complete the reCAPTCHA check before uploading.',
      status: 400,
    }
  }

  const formData = new URLSearchParams({
    response: token,
    secret: secretKey,
  })
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()

  if (forwardedFor) {
    formData.set('remoteip', forwardedFor)
  }

  let result: RecaptchaSiteVerifyResponse

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      body: formData,
      method: 'POST',
    })

    result = (await response.json()) as RecaptchaSiteVerifyResponse
  } catch {
    return {
      message: 'The reCAPTCHA check could not be verified.',
      status: 502,
    }
  }

  if (!result.success) {
    return {
      message: 'The reCAPTCHA check failed. Please try again.',
      status: 400,
    }
  }

  if (result.action && result.action !== recaptchaAction) {
    return {
      message: 'The reCAPTCHA check did not match this upload form.',
      status: 400,
    }
  }

  if (
    Number.isFinite(recaptchaMinimumScore) &&
    typeof result.score === 'number' &&
    result.score < recaptchaMinimumScore
  ) {
    return {
      message: 'The reCAPTCHA check failed. Please try again.',
      status: 400,
    }
  }

  return null
}

const getContactData = (data: PayloadRequest['data']) => {
  const contact =
    data?.contact && typeof data.contact === 'object'
      ? (data.contact as Record<string, unknown>)
      : {}

  return {
    businessName: getTrimmedString(
      contact.businessName ?? data?.['contact.businessName'],
    ),
    email: getTrimmedString(contact.email ?? data?.['contact.email']),
    firstName: getTrimmedString(contact.firstName ?? data?.['contact.firstName']),
    lastName: getTrimmedString(contact.lastName ?? data?.['contact.lastName']),
  }
}

const getMediaFolderID = async (
  req: PayloadRequest,
  folderName: string,
  parentFolderID?: number,
) => {
  const existingFolders = await req.payload.find({
    collection: 'payload-folders',
    depth: 0,
    limit: 25,
    req,
    select: {
      folder: true,
      folderType: true,
      name: true,
    },
    where: {
      name: {
        equals: folderName,
      },
    },
  })
  const folder = existingFolders.docs.find((doc) => {
    const folderType = 'folderType' in doc && Array.isArray(doc.folderType) ? doc.folderType : []
    const parentFolder = 'folder' in doc ? doc.folder : null
    const parentID =
      typeof parentFolder === 'number'
        ? parentFolder
        : parentFolder && typeof parentFolder === 'object'
          ? parentFolder.id
          : undefined
    const isSameParent = parentFolderID ? parentID === parentFolderID : !parentID

    return isSameParent && (folderType.length === 0 || folderType.includes('media'))
  })

  if (folder) {
    return folder.id
  }

  const createdFolder = await req.payload.create({
    collection: 'payload-folders',
    data: {
      folderType: ['media'],
      ...(parentFolderID ? { folder: parentFolderID } : {}),
      name: folderName,
    },
    req,
  })

  return createdFolder.id
}

const getUploadFileCopy = (file: NonNullable<PayloadRequest['file']>) => ({
  data: Buffer.from(file.data),
  mimetype: file.mimetype,
  name: file.name,
  size: file.size,
  ...(file.tempFilePath ? { tempFilePath: file.tempFilePath } : {}),
})

const copyUploadFile = (file: ReturnType<typeof getUploadFileCopy>) => ({
  ...file,
  data: Buffer.from(file.data),
})

const getGoogleDriveFolderID = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const normalizeFolderName = (value: unknown) => {
  if (typeof value !== 'string') {
    return ''
  }

  return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message

    if (typeof message === 'string') {
      return message
    }
  }

  return 'Unknown error'
}

const sleep = (delayMS: number) => new Promise((resolve) => setTimeout(resolve, delayMS))

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    create: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
    read: () => true,
    update: ({ req }) => Boolean(req.user),
  },
  admin: {
    components: {
      beforeListTable: ['/components/DownloadSelectedMediaButton#DownloadSelectedMediaButton'],
    },
    defaultColumns: ['filename', 'alt', 'albumName', 'photoCredit', 'publications', 'createdAt'],
  },
  endpoints: [
    {
      path: '/public-upload',
      method: 'post',
      handler: async (req) => {
        await addDataAndFileToRequest(req)

        if (!req.file) {
          return Response.json({ message: 'No file was uploaded.' }, { status: 400 })
        }

        if (!req.file.mimetype.startsWith('image/')) {
          return Response.json({ message: 'Only image uploads are allowed.' }, { status: 415 })
        }

        if (!isAccepted(req.data?.licenseAgreement)) {
          return Response.json(
            { message: 'You must agree to the submission terms before uploading.' },
            { status: 400 },
          )
        }

        const recaptchaError = await verifyRecaptcha(req)

        if (recaptchaError) {
          return Response.json(
            { message: recaptchaError.message },
            { status: recaptchaError.status },
          )
        }

        const contactData = getContactData(req.data)
        const businessFolderName = normalizeFolderName(contactData.businessName)
        const albumName = normalizeFolderName(req.data?.albumName)
        const photoCredit = getTrimmedString(req.data?.photoCredit)
        const publicationValues = getStringValues(req.data?.publications, req.data?.publication)
        const publicationIDs = getPublicationIDs(publicationValues)
        let folderID: number | undefined
        const sourceUploadFile = getUploadFileCopy(req.file)
        const sourceFileData = Buffer.from(sourceUploadFile.data)

        if (!businessFolderName) {
          return Response.json(
            { message: 'Business name is required before uploading.' },
            { status: 400 },
          )
        }

        if (!albumName) {
          return Response.json({ message: 'Album name is required before uploading.' }, { status: 400 })
        }

        if (!photoCredit) {
          return Response.json(
            { message: 'Photo credit is required before uploading.' },
            { status: 400 },
          )
        }

        if (publicationIDs === null) {
          return Response.json(
            { message: 'One or more publications are not available for uploads.' },
            { status: 400 },
          )
        }

        const publicationFolderIDs = new Map<number, number>()
        let publicationDocs: {
          googleDriveFolderId?: null | string
          id: number
          title: string
        }[] = []

        if (publicationIDs.length > 0) {
          if (publicationIDs.length !== publicationValues.length) {
            return Response.json(
              { message: 'That publication is not available for uploads.' },
              { status: 400 },
            )
          }

          const publications = await req.payload.find({
            collection: 'publications',
            depth: 0,
            limit: publicationIDs.length,
            req,
            select: {
              showOnFrontend: true,
              title: true,
              googleDriveFolderId: true,
            },
            where: {
              and: [
                {
                  id: {
                    in: publicationIDs,
                  },
                },
                {
                  showOnFrontend: {
                    equals: true,
                  },
                },
              ],
            },
          })

          publicationDocs = publications.docs

          if (publicationDocs.length !== publicationIDs.length) {
            return Response.json(
              { message: 'One or more publications are not available for uploads.' },
              { status: 400 },
            )
          }

          for (const publication of publicationDocs) {
            publicationFolderIDs.set(publication.id, await getMediaFolderID(req, publication.title))
          }

          folderID = publicationFolderIDs.get(publicationIDs[0])
        }

        const resolvePayloadFolderID = async (publicationID?: number) => {
          const publicationFolderID =
            typeof publicationID === 'number' ? publicationFolderIDs.get(publicationID) : folderID
          const businessFolderID = await getMediaFolderID(
            req,
            businessFolderName,
            publicationFolderID,
          )

          return getMediaFolderID(req, albumName, businessFolderID)
        }

        const resolveGoogleDriveFolderID = async (publicationFolderID?: null | string) => {
          const googleDriveFolderID = getGoogleDriveFolderID(publicationFolderID)

          if (!googleDriveFolderID) {
            return googleDriveFolderID
          }

          if (!isGoogleDriveUploadConfigured()) {
            return googleDriveFolderID
          }

          const businessFolder = await findOrCreateGoogleDriveFolder({
            name: businessFolderName,
            parentFolderId: googleDriveFolderID,
          })
          const albumFolder = await findOrCreateGoogleDriveFolder({
            name: albumName,
            parentFolderId: businessFolder.id,
          })

          return albumFolder.id
        }

        const baseData = {
          albumName,
          alt: getTrimmedString(req.data?.alt) || req.file.name,
          contact: contactData,
          licenseAgreement: true,
          photoCredit,
        }
        let mediaToCreate: {
          folder?: number
          googleDriveFolderId: null | string
          publications: number[]
        }[]

        try {
          mediaToCreate =
            publicationIDs.length > 1
              ? await Promise.all(
                  publicationIDs.map(async (publicationID) => ({
                    folder: await resolvePayloadFolderID(publicationID),
                    googleDriveFolderId: await resolveGoogleDriveFolderID(
                      publicationDocs.find((publication) => publication.id === publicationID)
                        ?.googleDriveFolderId,
                    ),
                    publications: [publicationID],
                  })),
                )
              : [
                  {
                    folder: await resolvePayloadFolderID(publicationIDs[0]),
                    googleDriveFolderId: await resolveGoogleDriveFolderID(
                      publicationDocs[0]?.googleDriveFolderId,
                    ),
                    publications: publicationIDs,
                  },
                ]
        } catch (error) {
          req.payload.logger.error({
            err: error,
            msg: 'Upload album folder preparation failed',
          })

          return Response.json(
            { message: 'The album folder could not be prepared. Please try again.' },
            { status: 502 },
          )
        }
        const results: MediaType[] = []

        for (const mediaData of mediaToCreate) {
          let result: MediaType | null = null
          let lastCreateError: unknown

          for (let attempt = 0; attempt <= mediaCreateRetryDelaysMS.length; attempt += 1) {
            try {
              result = await req.payload.create({
                collection: 'media',
                data: {
                  ...baseData,
                  ...(mediaData.folder ? { folder: mediaData.folder } : {}),
                  publications: mediaData.publications,
                },
                file: copyUploadFile(sourceUploadFile),
                req,
              })
              lastCreateError = null
              break
            } catch (error) {
              lastCreateError = error

              if (attempt >= mediaCreateRetryDelaysMS.length) {
                break
              }

              await sleep(mediaCreateRetryDelaysMS[attempt])
            }
          }

          if (lastCreateError) {
            req.payload.logger.error({
              albumName,
              businessFolderName,
              err: lastCreateError,
              folderID: mediaData.folder,
              msg: 'Payload media create failed',
              publications: mediaData.publications,
            })

            return Response.json(
              {
                message: `The file could not be saved in Payload: ${getErrorMessage(
                  lastCreateError,
                )}`,
              },
              { status: 400 },
            )
          }

          if (!result) {
            return Response.json(
              { message: 'The file could not be saved in Payload.' },
              { status: 400 },
            )
          }

          results.push(result)

          if (mediaData.googleDriveFolderId) {
            if (!isGoogleDriveUploadConfigured()) {
              return Response.json(
                {
                  message:
                    'This publication has a Google Drive folder selected, but Drive uploads are not configured.',
                },
                { status: 500 },
              )
            }

            try {
              const driveFile = await uploadFileToGoogleDrive({
                data: sourceFileData,
                description: `Photo credit: ${photoCredit}`,
                folderId: mediaData.googleDriveFolderId,
                mimeType: req.file.mimetype,
                name: result.filename || req.file.name,
                photoCredit,
              })

              const updatedResult = await req.payload.update({
                collection: 'media',
                data: {
                  googleDriveFileId: driveFile.id,
                  googleDriveFileUrl: driveFile.webViewLink,
                },
                id: result.id,
                req,
              })

              results[results.length - 1] = updatedResult
            } catch (error) {
              req.payload.logger.error({
                err: error,
                mediaID: result.id,
                msg: 'Google Drive upload failed',
              })

              return Response.json(
                { message: 'The file was saved, but the Google Drive upload failed.' },
                { status: 502 },
              )
            }
          }
        }

        const [result] = results

        return Response.json({
          id: result.id,
          alt: result.alt,
          filename: result.filename,
          contact: result.contact,
          photoCredit: result.photoCredit,
          publications: result.publications,
          albumName: result.albumName,
          files: results.map((createdMedia) => ({
            id: createdMedia.id,
            albumName: createdMedia.albumName,
            filename: createdMedia.filename,
            publications: createdMedia.publications,
            url: createdMedia.url,
          })),
          url: result.url,
        })
      },
    },
    {
      path: '/download-selected',
      method: 'get',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ message: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(
          req.url ?? '',
          process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
        )
        const ids = url.searchParams
          .get('ids')
          ?.split(',')
          .map((id) => id.trim())
          .filter(Boolean)

        if (!ids || ids.length === 0) {
          return Response.json(
            { message: 'Select at least one media item to download.' },
            { status: 400 },
          )
        }

        const numericIDs = ids.map((id) => Number(id))

        if (numericIDs.some((id) => !Number.isFinite(id))) {
          return Response.json(
            { message: 'One or more selected media IDs are invalid.' },
            { status: 400 },
          )
        }

        const media = await req.payload.find({
          collection: 'media',
          depth: 0,
          limit: ids.length,
          req,
          where: {
            id: {
              in: numericIDs,
            },
          },
        })
        const entries = (
          await Promise.all(
            media.docs
              .filter((doc) => doc.filename)
              .map(async (doc, index) => {
                try {
                  return {
                    data: await readFile(
                      path.resolve(process.cwd(), 'media', doc.filename as string),
                    ),
                    name:
                      media.docs.filter((entry) => entry.filename === doc.filename).length > 1
                        ? `${index + 1}-${doc.filename}`
                        : (doc.filename as string),
                  }
                } catch {
                  return null
                }
              }),
          )
        ).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

        if (entries.length === 0) {
          return Response.json({ message: 'No downloadable files were found.' }, { status: 404 })
        }

        const zip = createZip(entries)

        return new Response(zip, {
          headers: {
            'Content-Disposition': 'attachment; filename="media-download.zip"',
            'Content-Type': 'application/zip',
          },
        })
      },
    },
  ],
  fields: [
    {
      name: 'publications',
      type: 'relationship',
      hasMany: true,
      relationTo: 'publications',
    },
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
    {
      name: 'photoCredit',
      type: 'text',
      label: 'Photo credit',
    },
    {
      name: 'albumName',
      type: 'text',
      label: 'Album',
    },
    {
      name: 'contact',
      type: 'group',
      fields: [
        {
          name: 'firstName',
          type: 'text',
          label: 'First name',
        },
        {
          name: 'lastName',
          type: 'text',
          label: 'Last name',
        },
        {
          name: 'businessName',
          type: 'text',
          label: 'Business name',
        },
        {
          name: 'email',
          type: 'email',
          label: 'Email address',
        },
      ],
    },
    {
      name: 'licenseAgreement',
      type: 'checkbox',
      label: 'Submission agreement accepted',
      admin: {
        description: 'Checked when a public uploader accepted the submission terms.',
        readOnly: true,
      },
    },
    {
      name: 'googleDriveFileId',
      type: 'text',
      label: 'Google Drive file ID',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'googleDriveFileUrl',
      type: 'text',
      label: 'Google Drive file URL',
      admin: {
        readOnly: true,
      },
    },
  ],
  folders: true,
  upload: {
    mimeTypes: ['image/*'],
  },
}
