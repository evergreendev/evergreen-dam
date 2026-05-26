'use client'

import { useEffect, useRef, useState } from 'react'

type Grecaptcha = {
  execute: (siteKey: string, options: { action: string }) => Promise<string>
  ready: (callback: () => void) => void
}

declare global {
  interface Window {
    grecaptcha?: Grecaptcha
  }
}

type ContactInfo = {
  businessName: string
  email: string
  firstName: string
  lastName: string
}

type UploadItem = {
  error?: string
  file: File
  id: string
  isRemoving?: boolean
  photoCredit: string
  previewUrl: string
  progress: 'ready' | 'uploading' | 'complete' | 'error'
  uploadedUrl?: string | null
}

type UploadedItem = {
  fileName: string
  id: string
  photoCredit: string
  previewUrl: string
}

type PublicationOption = {
  id: string
  title: string
}

type UploadDropzoneProps = {
  fixedPublication?: PublicationOption
  publications: PublicationOption[]
  recaptchaSiteKey?: string
}

const endpoint = '/api/media/public-upload'
const removalFadeMS = 450
const recaptchaAction = process.env.NEXT_PUBLIC_RECAPTCHA_ACTION || 'public_upload'
const uploadedItemVisibleMS = 2500
const licenseAgreementText =
  'By submitting photos to this FTP site, you grant Evergreen Media and its affiliated publications a non-exclusive, royalty-free, perpetual, worldwide license to edit, reproduce, publish, distribute and otherwise use the submitted images in print, digital and promotional formats. You confirm that you own the rights to the images or have permission from the rightsholder to grant this license, and that any identifiable individuals depicted have given appropriate consent for their likeness to be used. Submissions may be cropped or otherwise adjusted for editorial and production purposes without additional approval. If used, we will provide appropriate photo credit. Submission does not guarantee publication.'
const emptyContact: ContactInfo = {
  businessName: '',
  email: '',
  firstName: '',
  lastName: '',
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const createUploadItem = (file: File): UploadItem => ({
  file,
  id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
  photoCredit: '',
  previewUrl: URL.createObjectURL(file),
  progress: 'ready',
})

export function UploadDropzone({
  fixedPublication,
  publications,
  recaptchaSiteKey,
}: UploadDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef<UploadItem[]>([])
  const removalTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map())
  const uploadedItemsRef = useRef<UploadedItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [contact, setContact] = useState<ContactInfo>(emptyContact)
  const [items, setItems] = useState<UploadItem[]>([])
  const [licenseAgreementAccepted, setLicenseAgreementAccepted] = useState(false)
  const [recaptchaError, setRecaptchaError] = useState<string | null>(null)
  const [uploadedItems, setUploadedItems] = useState<UploadedItem[]>([])
  const [selectedPublicationIDs, setSelectedPublicationIDs] = useState<string[]>(
    fixedPublication ? [fixedPublication.id] : [],
  )
  const hasPendingItems = items.some(
    (item) => item.progress === 'ready' || item.progress === 'error',
  )

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    uploadedItemsRef.current = uploadedItems
  }, [uploadedItems])

  useEffect(() => {
    return () => {
      removalTimersRef.current.forEach((timers) => {
        timers.forEach((timer) => clearTimeout(timer))
      })
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      uploadedItemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    }
  }, [])

  useEffect(() => {
    if (!recaptchaSiteKey || document.querySelector('script[data-recaptcha-script="true"]')) {
      return
    }

    const script = document.createElement('script')
    script.async = true
    script.dataset.recaptchaScript = 'true'
    script.defer = true
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(
      recaptchaSiteKey,
    )}`

    document.head.appendChild(script)
  }, [recaptchaSiteKey])

  const updateItem = (id: string, updates: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...updates } : item)))
  }

  const fillEmptyPhotoCredits = (sourceID: string) => {
    setItems((current) => {
      const sourceCredit = current.find((item) => item.id === sourceID)?.photoCredit

      if (!sourceCredit?.trim()) {
        return current
      }

      return current.map((item) =>
        item.id !== sourceID && item.photoCredit.trim() === ''
          ? { ...item, photoCredit: sourceCredit }
          : item,
      )
    })
  }

  const updateContact = (updates: Partial<ContactInfo>) => {
    setContact((current) => ({ ...current, ...updates }))
  }

  const clearRemovalTimers = (id: string) => {
    const timers = removalTimersRef.current.get(id)

    if (timers) {
      timers.forEach((timer) => clearTimeout(timer))
      removalTimersRef.current.delete(id)
    }
  }

  const removeItem = (id: string) => {
    clearRemovalTimers(id)
    setItems((current) => {
      const item = current.find((currentItem) => currentItem.id === id)

      if (item) {
        URL.revokeObjectURL(item.previewUrl)
      }

      return current.filter((currentItem) => currentItem.id !== id)
    })
  }

  const scheduleItemRemoval = (id: string, delay = uploadedItemVisibleMS) => {
    clearRemovalTimers(id)

    const startTimer = setTimeout(() => {
      updateItem(id, { isRemoving: true })

      const removeTimer = setTimeout(() => {
        removeItem(id)
      }, removalFadeMS)
      const timers = removalTimersRef.current.get(id) ?? []
      removalTimersRef.current.set(id, [...timers, removeTimer])
    }, delay)

    removalTimersRef.current.set(id, [startTimer])
  }

  const togglePublication = (publicationID: string) => {
    setSelectedPublicationIDs((current) =>
      current.includes(publicationID)
        ? current.filter((selectedID) => selectedID !== publicationID)
        : [...current, publicationID],
    )
  }

  const getRecaptchaToken = async () => {
    if (!recaptchaSiteKey) {
      throw new Error('Upload protection is not configured.')
    }

    if (!window.grecaptcha) {
      throw new Error('The reCAPTCHA check is still loading. Please try again.')
    }

    return new Promise<string>((resolve, reject) => {
      window.grecaptcha?.ready(() => {
        window.grecaptcha
          ?.execute(recaptchaSiteKey, { action: recaptchaAction })
          .then(resolve)
          .catch(() => reject(new Error('The reCAPTCHA check failed. Please try again.')))
      })
    })
  }

  const uploadFile = async (
    item: UploadItem,
    publicationIDs: string[],
    contactInfo: ContactInfo,
    agreementAccepted: boolean,
  ) => {
    updateItem(item.id, { progress: 'uploading' })

    const formData = new FormData()
    const alt = item.file.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ')

    formData.append('file', item.file)
    formData.append(
      '_payload',
      JSON.stringify({
        alt,
        photoCredit: item.photoCredit,
        contact: contactInfo,
        licenseAgreement: agreementAccepted,
        publications: publicationIDs,
      }),
    )
    formData.append('alt', alt)
    formData.append('photoCredit', item.photoCredit)
    formData.append('contact.firstName', contactInfo.firstName)
    formData.append('contact.lastName', contactInfo.lastName)
    formData.append('contact.businessName', contactInfo.businessName)
    formData.append('contact.email', contactInfo.email)
    formData.append('licenseAgreement', agreementAccepted ? 'true' : 'false')
    publicationIDs.forEach((publicationID) => {
      formData.append('publications', publicationID)
    })

    try {
      const recaptchaToken = await getRecaptchaToken()

      formData.append('recaptchaToken', recaptchaToken)

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
      setUploadedItems((current) => [
        {
          fileName: item.file.name,
          id: `${item.id}-uploaded`,
          photoCredit: item.photoCredit,
          previewUrl: URL.createObjectURL(item.file),
        },
        ...current,
      ])
      scheduleItemRemoval(item.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed.'

      if (message.toLowerCase().includes('recaptcha')) {
        setRecaptchaError(message)
      }

      updateItem(item.id, {
        isRemoving: false,
        error: message,
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

    itemsRef.current
      .filter((item) => item.progress === 'complete')
      .forEach((item) => scheduleItemRemoval(item.id, 0))

    setItems((current) => [...nextItems, ...current])
  }

  const submitUploads = async () => {
    if (!licenseAgreementAccepted) {
      return
    }

    setIsSubmitting(true)
    const publicationIDs = selectedPublicationIDs
    const contactForUploads = contact
    const agreementAcceptedForUploads = licenseAgreementAccepted

    try {
      for (const item of itemsRef.current) {
        const currentItem = itemsRef.current.find((current) => current.id === item.id)

        if (currentItem && (currentItem.progress === 'ready' || currentItem.progress === 'error')) {
          await uploadFile(
            currentItem,
            publicationIDs,
            contactForUploads,
            agreementAcceptedForUploads,
          )
        }
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="uploadPage">
      <header className="uploadBrandBar">
        <div>
          <img alt="Evergreen Media" src="/evergreen-logo.png" />
        </div>
        <span>Fresh. Enduring. Relevant.</span>
      </header>
      <section className="uploadShell" aria-labelledby="upload-title">
        <div className="uploadHeader">
          <p className="eyebrow">Creating Connections</p>
          <h1 id="upload-title">Evergreen image dropbox</h1>
          <p className="lede">
            {fixedPublication
              ? `Upload images for ${fixedPublication.title}.`
              : 'Choose publications to tag images for print, digital, and promotional work.'}
          </p>
        </div>

        {fixedPublication ? (
          <div className="fixedPublication">
            <span>{fixedPublication.title}</span>
          </div>
        ) : (
          <fieldset className="publicationChooser" aria-label="Publications">
            {publications.length > 0 ? (
              <>
                <label className="publicationOption">
                  <input
                    checked={selectedPublicationIDs.length === 0}
                    name="no-publications"
                    onChange={() => setSelectedPublicationIDs([])}
                    suppressHydrationWarning
                    type="checkbox"
                    value=""
                  />
                  <span>No publications</span>
                </label>
                {publications.map((publication) => (
                  <label className="publicationOption" key={publication.id}>
                    <input
                      checked={selectedPublicationIDs.includes(publication.id)}
                      name="publications"
                      onChange={() => togglePublication(publication.id)}
                      suppressHydrationWarning
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
        )}

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
          suppressHydrationWarning
          type="file"
        />

        {items.length > 0 && (
          <>
            <fieldset className="contactField uploadContactField">
              <legend>Contact</legend>
              <label>
                <span>First name</span>
                <input
                  autoComplete="given-name"
                  name="contactFirstName"
                  onChange={(event) => updateContact({ firstName: event.target.value })}
                  suppressHydrationWarning
                  type="text"
                  value={contact.firstName}
                />
              </label>
              <label>
                <span>Last name</span>
                <input
                  autoComplete="family-name"
                  name="contactLastName"
                  onChange={(event) => updateContact({ lastName: event.target.value })}
                  suppressHydrationWarning
                  type="text"
                  value={contact.lastName}
                />
              </label>
              <label>
                <span>Business name</span>
                <input
                  autoComplete="organization"
                  name="contactBusinessName"
                  onChange={(event) => updateContact({ businessName: event.target.value })}
                  suppressHydrationWarning
                  type="text"
                  value={contact.businessName}
                />
              </label>
              <label>
                <span>Email address</span>
                <input
                  autoComplete="email"
                  name="contactEmail"
                  onChange={(event) => updateContact({ email: event.target.value })}
                  suppressHydrationWarning
                  type="email"
                  value={contact.email}
                />
              </label>
            </fieldset>

            <section className="licenseAgreement" aria-labelledby="license-agreement-title">
              <h2 id="license-agreement-title">Submission agreement</h2>
              <p>{licenseAgreementText}</p>
              <label className="licenseAgreementCheck">
                <input
                  checked={licenseAgreementAccepted}
                  disabled={isSubmitting}
                  name="licenseAgreement"
                  onChange={(event) => setLicenseAgreementAccepted(event.target.checked)}
                  required
                  suppressHydrationWarning
                  type="checkbox"
                />
                <span>I have read and agree to these submission terms.</span>
              </label>
            </section>

            <div className="uploadList" aria-live="polite">
              {items.map((item) => (
                <article
                  className={`uploadItem${item.isRemoving ? ' isRemoving' : ''}`}
                  key={item.id}
                >
                  <img alt="" className="uploadPreview" src={item.previewUrl} />
                  <div className="uploadDetails">
                    <div>
                      <h2>{item.file.name}</h2>
                      <p>{formatBytes(item.file.size)}</p>
                    </div>
                    {item.progress === 'error' ? (
                      <div className="uploadActions">
                        <span className="uploadStatus error">{item.error}</span>
                        <button
                          className="removeUpload"
                          disabled={isSubmitting}
                          onClick={() => removeItem(item.id)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="uploadActions">
                        <span className={`uploadStatus ${item.progress}`}>
                          {item.progress === 'ready' && 'Ready'}
                          {item.progress === 'uploading' && 'Uploading'}
                          {item.progress === 'complete' && 'Uploaded'}
                        </span>
                        {item.progress === 'ready' && (
                          <button
                            className="removeUpload"
                            disabled={isSubmitting}
                            onClick={() => removeItem(item.id)}
                            type="button"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="creditField">
                    <label>
                      <span>Photo credit</span>
                      <input
                        name={`photoCredit-${item.id}`}
                        onChange={(event) =>
                          updateItem(item.id, { photoCredit: event.target.value })
                        }
                        suppressHydrationWarning
                        type="text"
                        value={item.photoCredit}
                      />
                    </label>
                    {item.photoCredit.trim() !== '' &&
                      items.some(
                        (otherItem) =>
                          otherItem.id !== item.id && otherItem.photoCredit.trim() === '',
                      ) && (
                        <button
                          className="fillEmptyCredits"
                          disabled={isSubmitting}
                          onClick={() => fillEmptyPhotoCredits(item.id)}
                          type="button"
                        >
                          Copy value to all empty Photo Credit fields
                        </button>
                      )}
                  </div>
                </article>
              ))}
              <button
                className="submitUploads"
                disabled={
                  isSubmitting || !hasPendingItems || !licenseAgreementAccepted || !recaptchaSiteKey
                }
                onClick={() => {
                  setRecaptchaError(null)
                  void submitUploads()
                }}
                type="button"
              >
                {isSubmitting ? 'Submitting' : 'Submit'}
              </button>
              {(!recaptchaSiteKey || recaptchaError) && (
                <p className="uploadSubmitError" role="status">
                  {recaptchaError || 'Upload protection is not configured.'}
                </p>
              )}
            </div>
          </>
        )}

        {uploadedItems.length > 0 && (
          <section className="successfulUploads" aria-labelledby="successful-uploads-title">
            <h2 id="successful-uploads-title">Successfully uploaded files</h2>
            <div className="successfulUploadList">
              {uploadedItems.map((item) => (
                <article className="successfulUploadItem" key={item.id}>
                  <img alt="" src={item.previewUrl} />
                  <div>
                    <h3>{item.fileName}</h3>
                    {item.photoCredit && <p>Photo Credit: {item.photoCredit}</p>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </div>
  )
}
