'use client'

import { Button, toast, useDocumentInfo } from '@payloadcms/ui'
import { useState } from 'react'

export const SendPasswordSetEmailButton = () => {
  const { id } = useDocumentInfo()
  const [isSending, setIsSending] = useState(false)

  if (!id) {
    return null
  }

  return (
    <Button
      buttonStyle="secondary"
      disabled={isSending}
      onClick={async () => {
        setIsSending(true)

        try {
          const response = await fetch(`/api/users/${id}/send-password-set-email`, {
            method: 'POST',
          })
          const result = (await response.json().catch(() => null)) as { message?: string } | null

          if (!response.ok) {
            throw new Error(result?.message || 'Unable to send password set email.')
          }

          toast.success(result?.message || 'Password set email sent.')
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Unable to send password set email.')
        } finally {
          setIsSending(false)
        }
      }}
      type="button"
    >
      {isSending ? 'Sending...' : 'Send password set email'}
    </Button>
  )
}
