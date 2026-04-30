import { addDataAndFileToRequest, type CollectionConfig, type PayloadRequest } from 'payload'

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
        .filter((item): item is number | string => typeof item === 'number' || typeof item === 'string')
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

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    create: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
    read: () => true,
    update: ({ req }) => Boolean(req.user),
  },
  admin: {
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
          return Response.json({ message: 'One or more publications are not available for uploads.' }, { status: 400 })
        }

        if (publicationIDs.length > 0) {
          if (publicationIDs.length !== publicationValues.length) {
            return Response.json({ message: 'That publication is not available for uploads.' }, { status: 400 })
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
            return Response.json({ message: 'One or more publications are not available for uploads.' }, { status: 400 })
          }

          const folderPublication =
            publications.docs.find((publication) => publication.id === publicationIDs[0]) ?? publications.docs[0]

          folderID = await getMediaFolderID(req, folderPublication.title)
        }

        const result = await req.payload.create({
          collection: 'media',
          data: {
            alt:
              typeof req.data?.alt === 'string' && req.data.alt.trim()
                ? req.data.alt
                : req.file.name,
            ...(folderID ? { folder: folderID } : {}),
            photoCredit: typeof req.data?.photoCredit === 'string' ? req.data.photoCredit.trim() : '',
            publications: publicationIDs,
          },
          file: req.file,
          req,
        })

        return Response.json({
          id: result.id,
          alt: result.alt,
          filename: result.filename,
          photoCredit: result.photoCredit,
          publications: result.publications,
          url: result.url,
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
  ],
  folders: true,
  upload: {
    mimeTypes: ['image/*'],
  },
}
