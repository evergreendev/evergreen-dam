'use client'

import { Button, useFolder, useSelection } from '@payloadcms/ui'

const getID = (value: unknown) => {
  if (value && typeof value === 'object' && 'id' in value) {
    return value.id
  }

  return value
}

export const DownloadSelectedMediaButton = () => {
  const { selectedIDs } = useSelection()
  const { getSelectedItems } = useFolder()
  const folderSelectedMediaIDs =
    getSelectedItems?.()
      .filter((item) => item.relationTo === 'media')
      .map((item) => getID(item.value))
      .filter((id): id is number | string => typeof id === 'number' || typeof id === 'string') ?? []
  const mediaIDs = selectedIDs.length > 0 ? selectedIDs : folderSelectedMediaIDs

  if (mediaIDs.length === 0) {
    return null
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
      <Button
        buttonStyle="secondary"
        onClick={() => {
          const params = new URLSearchParams({
            ids: mediaIDs.join(','),
          })

          window.location.href = `/api/media/download-selected?${params.toString()}`
        }}
        type="button"
      >
        Download selected files
      </Button>
    </div>
  )
}
