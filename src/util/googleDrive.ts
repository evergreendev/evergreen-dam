import { Readable } from 'stream'

import { google } from 'googleapis'

type GoogleDriveUploadInput = {
  data: Buffer
  description?: string
  folderId: string
  mimeType: string
  name: string
  photoCredit?: string
}

type GoogleDriveFolderInput = {
  name: string
  parentFolderId: string
}

export type GoogleDriveUploadResult = {
  id: string
  webViewLink: string | null
}

const driveRetryDelaysMS = [400, 900, 1800]

const sleep = (delayMS: number) => new Promise((resolve) => setTimeout(resolve, delayMS))

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

const getDrive = () => {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = getPrivateKey()

  if (!clientEmail || !privateKey) {
    throw new Error('Google Drive uploads are not configured.')
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })

  return google.drive({ auth, version: 'v3' })
}

const escapeDriveQueryValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

const getGoogleErrorStatus = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return null
  }

  const maybeError = error as {
    code?: unknown
    response?: {
      status?: unknown
    }
    status?: unknown
  }
  const status = maybeError.response?.status ?? maybeError.status ?? maybeError.code

  return typeof status === 'number' ? status : null
}

const isRetryableGoogleDriveError = (error: unknown) => {
  const status = getGoogleErrorStatus(error)

  if (status && (status === 403 || status === 404 || status === 409 || status === 429 || status >= 500)) {
    return true
  }

  return error instanceof Error && /file not found|not found|rate limit|backend error/i.test(error.message)
}

export const findOrCreateGoogleDriveFolder = async ({
  name,
  parentFolderId,
}: GoogleDriveFolderInput): Promise<GoogleDriveUploadResult> => {
  const drive = getDrive()
  const escapedName = escapeDriveQueryValue(name)
  const escapedParentFolderID = escapeDriveQueryValue(parentFolderId)
  const existingFolders = await drive.files.list({
    fields: 'files(id, name, webViewLink)',
    includeItemsFromAllDrives: true,
    pageSize: 10,
    q: [
      `'${escapedParentFolderID}' in parents`,
      `name = '${escapedName}'`,
      "mimeType = 'application/vnd.google-apps.folder'",
      'trashed = false',
    ].join(' and '),
    supportsAllDrives: true,
  })
  const existingFolder = existingFolders.data.files?.find((file) => file.id)

  if (existingFolder?.id) {
    return {
      id: existingFolder.id,
      webViewLink: existingFolder.webViewLink ?? null,
    }
  }

  const response = await drive.files.create({
    fields: 'id, webViewLink',
    requestBody: {
      mimeType: 'application/vnd.google-apps.folder',
      name,
      parents: [parentFolderId],
    },
    supportsAllDrives: true,
  })

  if (!response.data.id) {
    throw new Error('Google Drive did not return a folder ID.')
  }

  return {
    id: response.data.id,
    webViewLink: response.data.webViewLink ?? null,
  }
}

export const uploadFileToGoogleDrive = async ({
  data,
  description,
  folderId,
  mimeType,
  name,
  photoCredit,
}: GoogleDriveUploadInput): Promise<GoogleDriveUploadResult> => {
  const drive = getDrive()
  let lastError: unknown
  const trimmedDescription = description?.trim()
  const trimmedPhotoCredit = photoCredit?.trim()

  for (let attempt = 0; attempt <= driveRetryDelaysMS.length; attempt += 1) {
    try {
      const response = await drive.files.create({
        fields: 'id, webViewLink',
        media: {
          body: Readable.from(data),
          mimeType,
        },
        requestBody: {
          ...(trimmedDescription ? { description: trimmedDescription } : {}),
          ...(trimmedPhotoCredit ? { appProperties: { photoCredit: trimmedPhotoCredit } } : {}),
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
    } catch (error) {
      lastError = error

      if (attempt >= driveRetryDelaysMS.length || !isRetryableGoogleDriveError(error)) {
        break
      }

      await sleep(driveRetryDelaysMS[attempt])
    }
  }

  throw lastError
}
