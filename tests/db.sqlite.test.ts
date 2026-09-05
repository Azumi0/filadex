import { describe, expect, it } from "vitest";
import { normalizeSqliteUrl } from "../server/db.sqlite";
import { normalizeSqliteUrl as normalizeHarnessSqliteUrl } from "./helpers/dialect";

describe("SQLite URL normalization", () => {
  it("normalizes sqlite: URL scheme to file: for @libsql/client compatibility", () => {
    expect(normalizeSqliteUrl("sqlite:/data/filadex.db")).toBe("file:/data/filadex.db");
    expect(normalizeSqliteUrl("sqlite:///data/filadex.db")).toBe("file:///data/filadex.db");
    expect(normalizeSqliteUrl("file:/data/filadex.db")).toBe("file:/data/filadex.db");
  });

  it("normalizes sqlite: URL scheme in the test harness helper", () => {
    expect(normalizeHarnessSqliteUrl("sqlite:/data/filadex.db")).toBe("file:/data/filadex.db");
    expect(normalizeHarnessSqliteUrl("sqlite:///data/filadex.db")).toBe("file:///data/filadex.db");
    expect(normalizeHarnessSqliteUrl("file:/data/filadex.db")).toBe("file:/data/filadex.db");
  });
});

