import { useRef, useState } from "react"
import { authClient } from "./client"

export function useSignIn() {
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function signIn(callbackURL = "/") {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setFailed(false)

    try {
      const errorQuery = new URLSearchParams(window.location.search)
      errorQuery.set("error", "sign_in_failed")
      const result = await authClient.signIn.social({
        provider: "onionrings",
        callbackURL,
        errorCallbackURL: `/?${errorQuery}`,
      })
      if (result.error || !result.data.url) throw new Error("Sign-in failed")
    } catch {
      setFailed(true)
      setPending(false)
      busy.current = false
    }
  }

  return { pending, failed, signIn }
}
