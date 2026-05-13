import React from 'react'
import './styles.css'

export const metadata = {
  description: 'Evergreen Media digital asset management and public image uploads.',
  title: 'Evergreen Media DAM',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  )
}
