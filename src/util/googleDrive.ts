import { Readable } from 'stream'

import { google } from 'googleapis'

type GoogleDriveUploadInput = {
  data: Buffer
  folderId: string
  mimeType: string
  name: string
}

export type GoogleDriveUploadResult = {
  id: string
  webViewLink: string | null
}

const getPrivateKey = () => {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n')
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64) {
    return Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64, 'base64').toString('utf8')
  }

  return null
}

export const isGoogleDriveUploadConfigured = () =>
  Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && getPrivateKey())

export const uploadFileToGoogleDrive = async ({
  data,
  folderId,
  mimeType,
  name,
}: GoogleDriveUploadInput): Promise<GoogleDriveUploadResult> => {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = getPrivateKey()

  if (!clientEmail || !privateKey) {
    throw new Error('Google Drive uploads are not configured.')
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  })
  const drive = google.drive({ auth, version: 'v3' })
  const response = await drive.files.create({
    fields: 'id, webViewLink',
    media: {
      body: Readable.from(data),
      mimeType,
    },
    requestBody: {
      name,
      parents: [folderId],
    },
    supportsAllDrives: true,
  })

  if (!response.data.id) {
    throw new Error('Google Drive did not return a file ID.')
  }

  return {
    id: response.data.id,
    webViewLink: response.data.webViewLink ?? null,
  }
}
