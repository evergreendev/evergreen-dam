import type { CollectionConfig, PayloadRequest } from 'payload'

const getRouteParam = (value: unknown) => {
  if (Array.isArray(value)) {
    return value[0]
  }

  return typeof value === 'string' ? value : undefined
}

const getPasswordSetURL = ({
  req,
  token,
}: {
  req?: Pick<PayloadRequest, 'payload' | 'url'>
  token?: string
}) => {
  const origin =
    process.env.NEXT_PUBLIC_SERVER_URL || (req?.url ? new URL(req.url).origin : undefined) || ''
  const adminRoute = req?.payload?.config?.routes?.admin || '/admin'
  const resetRoute = req?.payload?.config?.admin?.routes?.reset || '/reset'

  return `${origin}${adminRoute}${resetRoute}/${token || ''}`
}

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    components: {
      edit: {
        beforeDocumentControls: ['/components/SendPasswordSetEmailButton#SendPasswordSetEmailButton'],
      },
    },
    useAsTitle: 'email',
  },
  auth: {
    forgotPassword: {
      generateEmailHTML: (args) => {
        const { req, token } = args || {}
        const passwordSetURL = getPasswordSetURL({ req, token })

        return `
          <p>You are receiving this because an administrator requested a password set link for your account.</p>
          <p><a href="${passwordSetURL}">Set your password</a></p>
          <p>If you did not expect this email, you can ignore it.</p>
        `
      },
      generateEmailSubject: () => 'Set your password',
    },
  },
  endpoints: [
    {
      path: '/:id/send-password-set-email',
      method: 'post',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ message: 'Unauthorized' }, { status: 401 })
        }

        const id = getRouteParam(req.routeParams?.id)

        if (!id) {
          return Response.json({ message: 'A user ID is required.' }, { status: 400 })
        }

        const user = await req.payload.findByID({
          collection: 'users',
          depth: 0,
          id,
          overrideAccess: false,
          req,
        })

        await req.payload.forgotPassword({
          collection: 'users',
          data: {
            email: user.email,
          },
          req,
        })

        return Response.json({ message: `Password set email sent to ${user.email}.` })
      },
    },
  ],
  fields: [
    // Email added by default
    // Add more fields as needed
  ],
}
