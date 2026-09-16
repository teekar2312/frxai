import { FinexApp } from '@/components/finex-app'
import { LoginScreen } from '@/components/auth/login-screen'
import {
  getSession,
  getAuthConfig,
  DEFAULT_ADMIN_PASSWORD,
} from '@/lib/auth-node'

export const dynamic = 'force-dynamic'

/**
 * `/` — satu-satunya route UI.
 *
 * Server-side gate: tanpa session valid → render LoginScreen;
 * dengan session → render dashboard lengkap.
 */
export default async function Home() {
  const session = await getSession()

  if (!session) {
    const cfg = getAuthConfig()
    return (
      <LoginScreen
        usingDefaultPassword={cfg.usingDefaultPassword}
        defaultUsername={cfg.username}
        defaultPassword={DEFAULT_ADMIN_PASSWORD}
      />
    )
  }

  return <FinexApp username={session.sub} />
}
