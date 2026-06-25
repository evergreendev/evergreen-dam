'use client'

import { Button, useField } from '@payloadcms/ui'
import type { UIFieldClientComponent } from 'payload'
import { useCallback, useEffect, useMemo, useState } from 'react'

type GooglePickerData = {
  action?: string
  docs?: {
    id?: string
    name?: string
    serviceId?: string
    url?: string
  }[]
}

type GooglePickerBuilder = {
  addView: (view: unknown) => GooglePickerBuilder
  build: () => { setVisible: (visible: boolean) => void }
  enableFeature: (feature: string) => GooglePickerBuilder
  setAppId: (appId: string) => GooglePickerBuilder
  setCallback: (callback: (data: GooglePickerData) => void) => GooglePickerBuilder
  setDeveloperKey: (key: string) => GooglePickerBuilder
  setOAuthToken: (token: string) => GooglePickerBuilder
}

declare global {
  interface Window {
    gapi?: {
      load: (api: string, callback: () => void) => void
    }
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            callback: (response: { access_token?: string; error?: string }) => void
            client_id: string
            scope: string
          }) => {
            requestAccessToken: (options?: { prompt?: string }) => void
          }
        }
      }
      picker?: {
        Action: {
          PICKED: string
        }
        DocsView: new () => {
          setIncludeFolders: (includeFolders: boolean) => unknown
          setMimeTypes: (mimeTypes: string) => unknown
          setSelectFolderEnabled: (selectFolderEnabled: boolean) => unknown
        }
        Feature: {
          SUPPORT_DRIVES: string
        }
        PickerBuilder: new () => GooglePickerBuilder
      }
    }
  }
}

const pickerAPIKey = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_PICKER_API_KEY
const pickerAppID = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_PICKER_APP_ID
const pickerClientID = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_PICKER_CLIENT_ID
const folderMimeType = 'application/vnd.google-apps.folder'

const loadScript = (id: string, src: string) =>
  new Promise<void>((resolve, reject) => {
    if (document.getElementById(id)) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.id = id
    script.src = src
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Could not load ${src}`))
    document.head.appendChild(script)
  })

export const GoogleDriveFolderPicker: UIFieldClientComponent = () => {
  const folderID = useField<string>({ path: 'googleDriveFolderId' })
  const folderName = useField<string>({ path: 'googleDriveFolderName' })
  const folderURL = useField<string>({ path: 'googleDriveFolderUrl' })
  const driveID = useField<string>({ path: 'googleDriveId' })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)

  const isConfigured = Boolean(pickerAPIKey && pickerAppID && pickerClientID)
  const selectedFolder = useMemo(() => {
    if (!folderID.value) {
      return null
    }

    return {
      id: folderID.value,
      name: folderName.value || folderID.value,
      url: folderURL.value,
    }
  }, [folderID.value, folderName.value, folderURL.value])

  useEffect(() => {
    if (!isConfigured) {
      return
    }

    let isMounted = true

    Promise.all([
      loadScript('google-api-js', 'https://apis.google.com/js/api.js'),
      loadScript('google-identity-services', 'https://accounts.google.com/gsi/client'),
    ])
      .then(() => {
        window.gapi?.load('picker', () => {
          if (isMounted) {
            setIsReady(true)
          }
        })
      })
      .catch(() => {
        if (isMounted) {
          setError('Google Drive Picker could not be loaded.')
        }
      })

    return () => {
      isMounted = false
    }
  }, [isConfigured])

  const openPicker = useCallback(
    (accessToken: string) => {
      if (!window.google?.picker || !pickerAPIKey || !pickerAppID) {
        setError('Google Drive Picker is not ready.')
        return
      }

      const view = new window.google.picker.DocsView()
      view.setIncludeFolders(true)
      view.setMimeTypes(folderMimeType)
      view.setSelectFolderEnabled(true)

      const picker = new window.google.picker.PickerBuilder()
        .addView(view)
        .enableFeature(window.google.picker.Feature.SUPPORT_DRIVES)
        .setAppId(pickerAppID)
        .setDeveloperKey(pickerAPIKey)
        .setOAuthToken(accessToken)
        .setCallback((data) => {
          if (data.action !== window.google?.picker?.Action.PICKED) {
            return
          }

          const [doc] = data.docs || []

          if (!doc?.id) {
            setError('No folder was selected.')
            return
          }

          folderID.setValue(doc.id)
          folderName.setValue(doc.name || doc.id)
          folderURL.setValue(doc.url || `https://drive.google.com/drive/folders/${doc.id}`)
          driveID.setValue(doc.serviceId || '')
          setError(null)
        })
        .build()

      picker.setVisible(true)
    },
    [driveID, folderID, folderName, folderURL],
  )

  const chooseFolder = useCallback(() => {
    if (!pickerClientID || !window.google?.accounts?.oauth2) {
      setError('Google Drive Picker is not configured.')
      return
    }

    setIsLoading(true)
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      callback: (response) => {
        setIsLoading(false)

        if (response.error || !response.access_token) {
          setError('Google authorization failed.')
          return
        }

        openPicker(response.access_token)
      },
      client_id: pickerClientID,
      scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
    })

    tokenClient.requestAccessToken({ prompt: 'consent' })
  }, [openPicker])

  const clearFolder = useCallback(() => {
    folderID.setValue('')
    folderName.setValue('')
    folderURL.setValue('')
    driveID.setValue('')
    setError(null)
  }, [driveID, folderID, folderName, folderURL])

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <Button
          buttonStyle="secondary"
          disabled={!isConfigured || !isReady || isLoading}
          onClick={chooseFolder}
          size="small"
          type="button"
        >
          {selectedFolder ? 'Change Google Drive folder' : 'Choose Google Drive folder'}
        </Button>
        {selectedFolder ? (
          <Button buttonStyle="subtle" onClick={clearFolder} size="small" type="button">
            Clear folder
          </Button>
        ) : null}
      </div>

      {selectedFolder ? (
        <p style={{ margin: 0 }}>
          Upload destination:{' '}
          {selectedFolder.url ? (
            <a href={selectedFolder.url} rel="noreferrer" target="_blank">
              {selectedFolder.name}
            </a>
          ) : (
            selectedFolder.name
          )}
        </p>
      ) : (
        <p style={{ margin: 0 }}>
          No Google Drive folder selected. Uploads for this publication will only be stored in
          Payload.
        </p>
      )}

      {!isConfigured ? (
        <p style={{ color: 'var(--theme-error-500)', marginBottom: 0 }}>
          Add the Google Drive Picker public env vars before using the folder chooser.
        </p>
      ) : null}
      {error ? <p style={{ color: 'var(--theme-error-500)', marginBottom: 0 }}>{error}</p> : null}
    </div>
  )
}
