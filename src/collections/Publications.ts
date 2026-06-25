import type { CollectionConfig } from 'payload'
import { revalidatePath } from 'next/cache'
import { slugField } from 'payload'

const formatSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const revalidateUploadRoutes = (...slugs: (null | string | undefined)[]) => {
  revalidatePath('/upload')

  slugs.filter(Boolean).forEach((slug) => {
    revalidatePath(`/upload/${slug}`)
  })
}

export const Publications: CollectionConfig = {
  slug: 'publications',
  access: {
    create: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
    read: () => true,
    update: ({ req }) => Boolean(req.user),
  },
  admin: {
    defaultColumns: ['title', 'slug', 'showOnFrontend', 'media'],
    useAsTitle: 'title',
  },
  hooks: {
    afterChange: [
      ({ doc, previousDoc }) => {
        revalidateUploadRoutes(doc.slug, previousDoc?.slug)
      },
    ],
    afterDelete: [
      ({ doc }) => {
        revalidateUploadRoutes(doc.slug)
      },
    ],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    slugField(),
    {
      name: 'showOnFrontend',
      type: 'checkbox',
      defaultValue: true,
      label: 'Show on front end',
    },
    {
      type: 'collapsible',
      label: 'Google Drive storage',
      admin: {
        initCollapsed: false,
      },
      fields: [
        {
          name: 'googleDriveFolderPicker',
          type: 'ui',
          admin: {
            components: {
              Field: '/components/GoogleDriveFolderPicker#GoogleDriveFolderPicker',
            },
          },
        },
        {
          name: 'googleDriveFolderName',
          type: 'text',
          label: 'Google Drive folder name',
          admin: {
            readOnly: true,
          },
        },
        {
          name: 'googleDriveFolderUrl',
          type: 'text',
          label: 'Google Drive folder URL',
          admin: {
            readOnly: true,
          },
        },
        {
          name: 'googleDriveFolderId',
          type: 'text',
          label: 'Google Drive folder ID',
          admin: {
            readOnly: true,
          },
        },
        {
          name: 'googleDriveId',
          type: 'text',
          label: 'Google shared drive ID',
          admin: {
            description: 'Present when the selected folder is in a shared drive.',
            readOnly: true,
          },
        },
      ],
    },
    {
      name: 'media',
      type: 'join',
      collection: 'media',
      on: 'publications',
      admin: {
        allowCreate: false,
        defaultColumns: ['filename', 'alt', 'photoCredit', 'createdAt'],
      },
    },
  ],
}
