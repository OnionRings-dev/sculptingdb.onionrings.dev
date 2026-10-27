// Navigation guards only; credentials and cancellation authority stay on the server.
let signingOut = false
let generation = 0
export const authNavigation = {
  isSigningOut() {
    return signingOut
  },
  get generation() {
    return generation
  },
  beginSignOut() {
    signingOut = true
    generation++
  },
  retrySignOut() {
    signingOut = false
  },
}
