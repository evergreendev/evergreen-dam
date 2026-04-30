import type { CollectionConfig } from 'payload'
import { slugField } from 'payload'

const formatSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

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
