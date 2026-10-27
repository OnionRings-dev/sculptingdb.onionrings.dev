import { useRef, useState } from "react"
import { authClient } from "./client"
import { authNavigation } from "./navigation"

export function useSignIn() {
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function signIn(callbackURL = "/") {
    if (busy.current || authNavigation.isSigningOut()) return
    const generation = authNavigation.generation
    busy.current = true
    setPending(true)
    setFailed(false)

    try {
      const errorQuery = new URLSearchParams(window.location.search)
      errorQuery.set("error", "sign_in_failed")
      const result = await authClient.signIn.social({
        provider: "onionrings",
        disableRedirect: true,
        callbackURL,
        errorCallbackURL: `/?${errorQuery}`,
      })
      if (
        authNavigation.isSigningOut() ||
        generation !== authNavigation.generation
      )
        return
      if (result.error || !result.data.url) throw new Error("Sign-in failed")
      window.location.assign(result.data.url)
    } catch {
      setFailed(true)
      setPending(false)
      busy.current = false
    }
  }

  return { pending, failed, signIn }
}
