import { addDataAndFileToRequest, type CollectionConfig } from 'payload'

const getStringValue = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0].trim()
  }

  return ''
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
    defaultColumns: ['filename', 'alt', 'publication', 'createdAt'],
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

        const publicationValue = getStringValue(req.data?.publication)
        const publicationID = publicationValue ? Number(publicationValue) : null
        let folderID: number | undefined

        if (publicationValue) {
          if (!Number.isFinite(publicationID)) {
            return Response.json({ message: 'That publication is not available for uploads.' }, { status: 400 })
          }

          const publications = await req.payload.find({
            collection: 'publications',
            depth: 0,
            limit: 1,
            req,
            select: {
              showOnFrontend: true,
              title: true,
            },
            where: {
              and: [
                {
                  id: {
                    equals: publicationID,
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
          const publication = publications.docs[0]

          if (!publication) {
            return Response.json({ message: 'That publication is not available for uploads.' }, { status: 400 })
          }

          const existingFolders = await req.payload.find({
            collection: 'payload-folders',
            depth: 0,
            limit: 25,
            req,
            where: {
              name: {
                equals: publication.title,
              },
            },
          })
          const folder = existingFolders.docs.find((doc) => {
            const folderType = 'folderType' in doc && Array.isArray(doc.folderType) ? doc.folderType : []

            return folderType.length === 0 || folderType.includes('media')
          })

          if (folder) {
            folderID = folder.id
          } else {
            const createdFolder = await req.payload.create({
              collection: 'payload-folders',
              data: {
                folderType: ['media'],
                name: publication.title,
              },
              req,
            })
            folderID = createdFolder.id
          }
        }

        const result = await req.payload.create({
          collection: 'media',
          data: {
            alt:
              typeof req.data?.alt === 'string' && req.data.alt.trim()
                ? req.data.alt
                : req.file.name,
            ...(folderID ? { folder: folderID } : {}),
            ...(publicationID ? { publication: publicationID } : {}),
          },
          file: req.file,
          req,
        })

        return Response.json({
          id: result.id,
          alt: result.alt,
          filename: result.filename,
          publication: result.publication,
          url: result.url,
        })
      },
    },
  ],
  fields: [
    {
      name: 'publication',
      type: 'relationship',
      relationTo: 'publications',
    },
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  folders: true,
  upload: {
    mimeTypes: ['image/*'],
  },
}
