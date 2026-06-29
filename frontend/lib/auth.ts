// Azure AD MSAL configuration for Nuvho Proposal System

export const msalConfig = {
  auth: {
    clientId: process.env.NEXT_PUBLIC_AZURE_CLIENT_ID!,
    authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID}`,
    redirectUri: typeof window !== 'undefined'
      ? `${window.location.origin}/auth/callback`
      : `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    postLogoutRedirectUri: typeof window !== 'undefined'
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL,
  },
  cache: {
    cacheLocation: 'sessionStorage' as const,
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level: number, message: string) => {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[MSAL L${level}]`, message)
        }
      },
    },
  },
}

export const loginRequest = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
  prompt: 'select_account',
}

export const apiRequest = {
  scopes: [`api://${process.env.NEXT_PUBLIC_AZURE_CLIENT_ID}/proposals.read`],
}

// Validate that the user email is a @nuvho.com address
export function isNuvhoEmail(email: string): boolean {
  return email.toLowerCase().endsWith('@nuvho.com')
}
