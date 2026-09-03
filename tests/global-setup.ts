import type { TestProject } from "vitest/node";

/**
 * Provides the database the whole suite runs against.
 *
 *   TEST_DATABASE_URL set   -> that database is used as-is (CI, or a server you
 *                              already have running)
 *   TEST_DATABASE_URL unset -> a throwaway Postgres container is started here
 *                              and torn down when the run finishes
 *
 * It is always a real database server; there is no in-memory substitute, so
 * `LOWER()`, unique constraints, `serial`, `numeric`-as-string and `RETURNING`
 * behave exactly as they do in production.
 *
 * Note the variable is deliberately NOT the application's own DATABASE_URL:
 * tests/helpers/db.ts drops and recreates the public schema, which would
 * destroy a development database that happened to be configured in the shell.
 */

// Matches the version docker-compose.template.yml deploys.
const POSTGRES_IMAGE = "postgres:15-alpine";

export default async function setup({ provide }: TestProject) {
  if (process.env.TEST_DATABASE_URL) {
    provide("databaseUrl", process.env.TEST_DATABASE_URL);
    return;
  }

  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();

  provide("databaseUrl", container.getConnectionUri());

  return async () => {
    await container.stop();
  };
}

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
  }
}
