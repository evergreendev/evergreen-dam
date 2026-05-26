import type { Metadata } from 'next'
import configPromise from '@payload-config'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'

import { UploadDropzone } from '../UploadDropzone'

type UploadPublicationPageProps = {
  params: Promise<{
    slug: string
  }>
}

export const metadata: Metadata = {
  title: 'Upload Images',
}

export const dynamic = 'force-dynamic'

export default async function UploadPublicationPage({ params }: UploadPublicationPageProps) {
  const { slug } = await params
  const payload = await getPayload({ config: configPromise })
  const { docs } = await payload.find({
    collection: 'publications',
    depth: 0,
    limit: 1,
    where: {
      and: [
        {
          slug: {
            equals: slug,
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
  const publication = docs[0]

  if (!publication) {
    notFound()
  }

  const fixedPublication = {
    id: String(publication.id),
    title: publication.title,
  }

  return (
    <UploadDropzone
      fixedPublication={fixedPublication}
      publications={[fixedPublication]}
      recaptchaSiteKey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
    />
  )
}
