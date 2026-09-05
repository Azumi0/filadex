-- Hand-edited after generation. `materials` gains a nullable `user_id`
-- (NULL = Global Catalog, set = that user's Personal Catalog), and the plain
-- global UNIQUE(name) is replaced by two partial case-insensitive unique
-- indexes on lower(name) - one for the Global Catalog, one per Personal Catalog.
--
-- The guard below is the part drizzle-kit cannot generate: dropping
-- materials_name_key for a case-insensitive index fails on any install that
-- already holds two materials differing only by case (e.g. "PETG" and "petg"),
-- and a migration that fails partway would leave the table with neither the old
-- constraint nor the new indexes. Refusing - and naming the offending rows - is
-- correct: guessing which row to keep would silently discard a density or a
-- hygroscopic flag, and user_sharing.material_id points at one of them.
--
-- It runs before anything is dropped, so refusing leaves the table exactly as
-- it was without relying on the migration runner's transaction to undo a drop.
DO $$
DECLARE conflict text;
BEGIN
  -- Aggregated over the grouped set, not within each group: `string_agg`
  -- under the GROUP BY would only ever see one name per group, and SELECT INTO
  -- without STRICT keeps the first row - so an operator with three collisions
  -- would get three failed starts, each naming one.
  SELECT string_agg(duplicate, ', ') INTO conflict
    FROM (SELECT lower(name) AS duplicate FROM materials
          GROUP BY lower(name) HAVING count(*) > 1) duplicates;
  IF conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add case-insensitive material uniqueness: duplicate names exist (%). Merge or rename them, then re-run.', conflict;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "materials" DROP CONSTRAINT "materials_name_key";--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "materials_global_name_lower_idx" ON "materials" USING btree (lower("name")) WHERE "materials"."user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "materials_user_name_lower_idx" ON "materials" USING btree (coalesce("user_id", 0),lower("name")) WHERE "materials"."user_id" IS NOT NULL;
