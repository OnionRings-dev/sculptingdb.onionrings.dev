import { randomBytes } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"

const template = await readFile(
  new URL("../.env.example", import.meta.url),
  "utf8"
)
const databasePassword = randomBytes(24).toString("hex")
const contents = template
  .replace("POSTGRES_PASSWORD=", `POSTGRES_PASSWORD=${databasePassword}`)
  .replace("<url-encoded-password>", databasePassword)
  .replace(
    "BETTER_AUTH_SECRET=",
    `BETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}`
  )

try {
  await writeFile(new URL("../.env", import.meta.url), contents, {
    flag: "wx",
    mode: 0o600,
  })
  console.info(
    "Created .env with independent local database and app secrets. Add your OnionRings client credentials there."
  )
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  console.info("Kept existing .env unchanged.")
}
