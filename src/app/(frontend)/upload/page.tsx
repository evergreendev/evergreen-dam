import type { Metadata } from 'next'
import configPromise from '@payload-config'
import { getPayload } from 'payload'

import { UploadDropzone } from './UploadDropzone'

export const metadata: Metadata = {
  title: 'Upload Images',
}

export const dynamic = 'force-dynamic'

export default async function UploadPage() {
  const payload = await getPayload({ config: configPromise })
  const { docs } = await payload.find({
    collection: 'publications',
    depth: 0,
    limit: 100,
    sort: 'title',
    where: {
      showOnFrontend: {
        equals: true,
      },
    },
  })

  const publications = docs.map((publication) => ({
    id: String(publication.id),
    title: publication.title,
  }))

  return <UploadDropzone publications={publications} />
}
