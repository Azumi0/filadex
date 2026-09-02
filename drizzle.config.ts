import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Generated SQL migrations. The imperative migrations/*.ts scripts alongside
  // this directory are the legacy upgrade path; see scripts/migrate.ts.
  out: "./migrations/pg",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
