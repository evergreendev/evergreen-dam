'use client'

import { useEffect, useRef, useState } from 'react'

type UploadItem = {
  error?: string
  file: File
  id: string
  previewUrl: string
  progress: 'queued' | 'uploading' | 'complete' | 'error'
  uploadedUrl?: string | null
}

type PublicationOption = {
  id: string
  title: string
}

type UploadDropzoneProps = {
  publications: PublicationOption[]
}

const endpoint = '/api/media/public-upload'

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const createUploadItem = (file: File): UploadItem => ({
  file,
  id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
  previewUrl: URL.createObjectURL(file),
  progress: 'queued',
})

export function UploadDropzone({ publications }: UploadDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef<UploadItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [items, setItems] = useState<UploadItem[]>([])
  const [selectedPublication, setSelectedPublication] = useState('')

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    }
  }, [])

  const updateItem = (id: string, updates: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...updates } : item)))
  }

  const uploadFile = async (item: UploadItem) => {
    updateItem(item.id, { progress: 'uploading' })

    const formData = new FormData()
    formData.append('file', item.file)
    formData.append('alt', item.file.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' '))
    if (selectedPublication) {
      formData.append('publication', selectedPublication)
    }

    try {
      const response = await fetch(endpoint, {
        body: formData,
        method: 'POST',
      })

      const result = (await response.json().catch(() => null)) as {
        message?: string
        url?: string | null
      } | null

      if (!response.ok) {
        throw new Error(result?.message || 'Upload failed.')
      }

      updateItem(item.id, {
        progress: 'complete',
        uploadedUrl: result?.url,
      })
    } catch (error) {
      updateItem(item.id, {
        error: error instanceof Error ? error.message : 'Upload failed.',
        progress: 'error',
      })
    }
  }

  const addFiles = (fileList: FileList | File[]) => {
    const imageFiles = Array.from(fileList).filter((file) => file.type.startsWith('image/'))
    const nextItems = imageFiles.map(createUploadItem)

    if (nextItems.length === 0) {
      return
    }

    setItems((current) => [...nextItems, ...current])
    nextItems.forEach((item) => {
      void uploadFile(item)
    })
  }

  return (
    <div className="uploadPage">
      <section className="uploadShell" aria-labelledby="upload-title">
        <div className="uploadHeader">
          <p className="eyebrow">Public uploads</p>
          <h1 id="upload-title">Image dropbox</h1>
          <p className="lede">Choose a publication to tag images, or upload without one.</p>
        </div>

        <fieldset className="publicationChooser" aria-label="Publication">
          {publications.length > 0 ? (
            <>
              <label className="publicationOption">
                <input
                  checked={!selectedPublication}
                  name="publication"
                  onChange={() => setSelectedPublication('')}
                  type="checkbox"
                  value=""
                />
                <span>No publication</span>
              </label>
              {publications.map((publication) => (
                <label className="publicationOption" key={publication.id}>
                  <input
                    checked={selectedPublication === publication.id}
                    name="publication"
                    onChange={() => setSelectedPublication(publication.id)}
                    type="checkbox"
                    value={publication.id}
                  />
                  <span>{publication.title}</span>
                </label>
              ))}
            </>
          ) : (
            <p>No publications are available. Images will upload without a publication.</p>
          )}
        </fieldset>

        <button
          className={`dropzone${isDragging ? ' isDragging' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            if (event.currentTarget === event.target) {
              setIsDragging(false)
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            setIsDragging(false)
            addFiles(event.dataTransfer.files)
          }}
          type="button"
        >
          <span className="dropzoneIcon" aria-hidden="true">
            +
          </span>
          <span className="dropzoneTitle">Drop images or choose files</span>
          <span className="dropzoneMeta">PNG, JPG, GIF, WebP, SVG</span>
        </button>

        <input
          ref={fileInputRef}
          accept="image/*"
          className="fileInput"
          multiple
          onChange={(event) => {
            if (event.target.files) {
              addFiles(event.target.files)
              event.target.value = ''
            }
          }}
          type="file"
        />

        {items.length > 0 && (
          <div className="uploadList" aria-live="polite">
            {items.map((item) => (
              <article className="uploadItem" key={item.id}>
                <img alt="" className="uploadPreview" src={item.previewUrl} />
                <div className="uploadDetails">
                  <div>
                    <h2>{item.file.name}</h2>
                    <p>{formatBytes(item.file.size)}</p>
                  </div>
                  {item.progress === 'error' ? (
                    <span className="uploadStatus error">{item.error}</span>
                  ) : (
                    <span className={`uploadStatus ${item.progress}`}>
                      {item.progress === 'queued' && 'Queued'}
                      {item.progress === 'uploading' && 'Uploading'}
                      {item.progress === 'complete' && 'Uploaded'}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
