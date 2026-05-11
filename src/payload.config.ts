import { postgresAdapter } from '@payloadcms/db-postgres'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Publications } from './collections/Publications'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const serverURL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'
const smtpRejectUnauthorized = process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false'

export default buildConfig({
  admin: {
    user: Users.slug,
    components:{

    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Publications, Media],
  cors: [serverURL],
  csrf: [serverURL],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
  }),
  email: nodemailerAdapter({
    defaultFromAddress: process.env.SMTP_FROM_ADDRESS || 'noreply@example.com',
    defaultFromName: process.env.SMTP_FROM_NAME || 'Evergreen Dam',
    skipVerify: true,
    transportOptions: {
      auth: {
        pass: process.env.SMTP_PASS,
        user: process.env.SMTP_USER,
      },
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      tls: {
        rejectUnauthorized: smtpRejectUnauthorized,
      },
    },
  }),
  folders: {
    collectionSpecific: true,
  },
  serverURL,
  sharp,
  plugins: [],
})
