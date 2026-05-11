import { readFile } from 'fs/promises'
import path from 'path'
import { addDataAndFileToRequest, type CollectionConfig, type PayloadRequest } from 'payload'

import type { Media as MediaType } from '@/payload-types'
import { createZip } from '@/util/createZip'

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

const getMediaFolderID = async (req: PayloadRequest, folderName: string) => {
  const existingFolders = await req.payload.find({
    collection: 'payload-folders',
    depth: 0,
    limit: 25,
    req,
    where: {
      name: {
        equals: folderName,
      },
    },
  })
  const folder = existingFolders.docs.find((doc) => {
    const folderType = 'folderType' in doc && Array.isArray(doc.folderType) ? doc.folderType : []

    return folderType.length === 0 || folderType.includes('media')
  })

  if (folder) {
    return folder.id
  }

  const createdFolder = await req.payload.create({
    collection: 'payload-folders',
    data: {
      folderType: ['media'],
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
    defaultColumns: ['filename', 'alt', 'photoCredit', 'publications', 'createdAt'],
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

        const publicationValues = getStringValues(req.data?.publications, req.data?.publication)
        const publicationIDs = getPublicationIDs(publicationValues)
        let folderID: number | undefined

        if (publicationIDs === null) {
          return Response.json(
            { message: 'One or more publications are not available for uploads.' },
            { status: 400 },
          )
        }

        const publicationFolderIDs = new Map<number, number>()

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

          if (publications.docs.length !== publicationIDs.length) {
            return Response.json(
              { message: 'One or more publications are not available for uploads.' },
              { status: 400 },
            )
          }

          for (const publication of publications.docs) {
            publicationFolderIDs.set(publication.id, await getMediaFolderID(req, publication.title))
          }

          folderID = publicationFolderIDs.get(publicationIDs[0])
        }

        const baseData = {
          alt: getTrimmedString(req.data?.alt) || req.file.name,
          contact: getContactData(req.data),
          photoCredit: getTrimmedString(req.data?.photoCredit),
        }
        const mediaToCreate =
          publicationIDs.length > 1
            ? publicationIDs.map((publicationID) => ({
                folder: publicationFolderIDs.get(publicationID),
                publications: [publicationID],
              }))
            : [
                {
                  folder: folderID,
                  publications: publicationIDs,
                },
              ]
        const results: MediaType[] = []

        for (const mediaData of mediaToCreate) {
          const result = await req.payload.create({
            collection: 'media',
            data: {
              ...baseData,
              ...(mediaData.folder ? { folder: mediaData.folder } : {}),
              publications: mediaData.publications,
            },
            file: results.length === 0 ? req.file : getUploadFileCopy(req.file),
            req,
          })

          results.push(result)
        }

        const [result] = results

        return Response.json({
          id: result.id,
          alt: result.alt,
          filename: result.filename,
          contact: result.contact,
          photoCredit: result.photoCredit,
          publications: result.publications,
          files: results.map((createdMedia) => ({
            id: createdMedia.id,
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
  ],
  folders: true,
  upload: {
    mimeTypes: ['image/*'],
  },
}
