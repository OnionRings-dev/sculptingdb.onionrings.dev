export function mcpLoginCallback(search: string) {
  const query = new URLSearchParams(search)
  if (!query.has("sig")) return "/"
  // The OAuth provider verifies the original signed oauth_query on sign-in.
  // Resume authorization explicitly after the external provider callback, even
  // if that provider cannot restore Better Auth's OAuth-server context.
  for (const key of ["sig", "exp", "ba_iat", "ba_param", "ba_pl"])
    query.delete(key)
  const prompts = (query.get("prompt") ?? "")
    .split(" ")
    .filter((prompt) => prompt && prompt !== "login")
  if (prompts.length) query.set("prompt", prompts.join(" "))
  else query.delete("prompt")
  // A fresh external login has just fulfilled these reauthentication requests.
  query.delete("max_age")
  return `/api/auth/oauth2/authorize?${query}`
}
