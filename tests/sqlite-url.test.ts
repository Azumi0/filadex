import { describe, expect, it } from "vitest";
import { normalizeSqliteUrl } from "../server/sqlite-url";

describe("normalizeSqliteUrl", () => {
  it("rewrites the sqlite: scheme to file: for @libsql/client compatibility", () => {
    expect(normalizeSqliteUrl("sqlite:/data/filadex.db")).toBe("file:/data/filadex.db");
    expect(normalizeSqliteUrl("sqlite:///data/filadex.db")).toBe("file:///data/filadex.db");
  });

  it("leaves a file: URL untouched", () => {
    expect(normalizeSqliteUrl("file:/data/filadex.db")).toBe("file:/data/filadex.db");
    expect(normalizeSqliteUrl("file::memory:")).toBe("file::memory:");
  });
});
