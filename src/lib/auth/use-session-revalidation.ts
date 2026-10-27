import { useEffect } from "react"
import { getUser } from "./session.functions"
import { authNavigation } from "./navigation"

export function useSessionRevalidation(authenticated: boolean) {
  useEffect(() => {
    if (!authenticated) return
    let checking = false
    let disposed = false
    async function revalidate() {
      if (
        checking ||
        document.visibilityState !== "visible" ||
        authNavigation.isSigningOut()
      )
        return
      checking = true
      try {
        const user = await getUser()
        if (!disposed && !authNavigation.isSigningOut() && !user)
          window.location.replace("/")
      } catch {
        // Reload into the server's unavailable response. Do not keep showing
        // protected content or discard credentials during a provider outage.
        if (!disposed && !authNavigation.isSigningOut())
          window.location.reload()
      } finally {
        checking = false
      }
    }
    window.addEventListener("focus", revalidate)
    window.addEventListener("pageshow", revalidate)
    document.addEventListener("visibilitychange", revalidate)
    return () => {
      disposed = true
      window.removeEventListener("focus", revalidate)
      window.removeEventListener("pageshow", revalidate)
      document.removeEventListener("visibilitychange", revalidate)
    }
  }, [authenticated])
}
