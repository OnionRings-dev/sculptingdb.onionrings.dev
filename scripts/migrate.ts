import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error("DATABASE_URL is required")

const pool = new pg.Pool({ connectionString })
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" })
  console.info("Database migrations applied.")
} finally {
  await pool.end()
}
