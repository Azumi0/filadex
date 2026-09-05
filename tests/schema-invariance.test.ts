import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import path from "path";

describe("Schema invariance across dialects (ADR-0004)", () => {
  it("produces identical createInsertSchema definitions for all tables under Postgres and SQLite", () => {
    const script = `
import * as schema from './shared/schema';
import { createInsertSchema } from 'drizzle-zod';
import { isTable } from 'drizzle-orm';
import { z } from 'zod';

function describeZod(zodType) {
  if (!zodType || !zodType._def) return typeof zodType;
  const def = zodType._def;
  const typeName = def.typeName;
  if (typeName === 'ZodOptional') {
    return { type: 'ZodOptional', inner: describeZod(def.innerType) };
  }
  if (typeName === 'ZodNullable') {
    return { type: 'ZodNullable', inner: describeZod(def.innerType) };
  }
  if (typeName === 'ZodDefault') {
    return { type: 'ZodDefault', inner: describeZod(def.innerType) };
  }
  if (typeName === 'ZodEffects') {
    return { type: 'ZodEffects', inner: describeZod(def.schema), effectType: def.effect?.type };
  }
  if (typeName === 'ZodObject') {
    const shape = {};
    for (const [k, v] of Object.entries(zodType.shape)) {
      shape[k] = describeZod(v);
    }
    return { type: 'ZodObject', shape };
  }
  if (typeName === 'ZodUnion') {
    return { type: 'ZodUnion', options: def.options.map(describeZod) };
  }
  if (typeName === 'ZodEnum') {
    return { type: 'ZodEnum', values: def.values };
  }
  return { type: typeName };
}

const result = {};
for (const [key, value] of Object.entries(schema)) {
  if (isTable(value)) {
    result['table:' + key] = describeZod(createInsertSchema(value));
  } else if (value instanceof z.ZodType || (value && value._def)) {
    result['schema:' + key] = describeZod(value);
  }
}
console.log(JSON.stringify(result));
`;

    const repoRoot = path.resolve(__dirname, "..");

    const pgOutput = execFileSync(
      "npx",
      ["tsx", "-e", script],
      { cwd: repoRoot, encoding: "utf8" }
    ).trim();

    const sqliteOutput = execFileSync(
      "npx",
      ["tsx", "--tsconfig=tsconfig.sqlite.json", "-e", script],
      { cwd: repoRoot, encoding: "utf8" }
    ).trim();

    const pgSchemas = JSON.parse(pgOutput);
    const sqliteSchemas = JSON.parse(sqliteOutput);

    // Verify all table schemas and exported schemas are present
    expect(Object.keys(pgSchemas).length).toBeGreaterThan(15);
    expect(Object.keys(pgSchemas)).toEqual(Object.keys(sqliteSchemas));

    // Verify each table and exported schema matches identically
    for (const [name, pgDef] of Object.entries(pgSchemas)) {
      expect(sqliteSchemas[name], `Schema mismatch for ${name}`).toEqual(pgDef);
    }
  });
});
