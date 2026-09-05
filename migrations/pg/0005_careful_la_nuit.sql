-- Hand-edited after generation. `users` gains `username_folded` - the NFC
-- normalised, case-folded username - and the `lower(username)` expression index
-- is replaced by a plain unique index on that column.
--
-- drizzle-kit generates `ADD COLUMN ... NOT NULL` with no default, which fails
-- on any populated table, and it cannot know how to fill the column. The
-- backfill and the guard below are the hand-written parts.
--
-- Why the column exists at all: `LOWER()` folds only ASCII when the database's
-- lc_ctype is C, so `lower('MÜLLER')` is `'mÜller'` there and `'müller'` on a
-- UTF-8 locale. While usernames were ASCII-only that difference could not
-- matter. Now that they may hold diacritics, leaving the fold to the database
-- would make uniqueness and login mean different things on different installs.
-- foldUsername in shared/schema.ts is the single definition; this column is its
-- stored result.
DO $$
DECLARE
  non_ascii bigint;
  conflict text;
BEGIN
  SELECT count(*) INTO non_ascii FROM users WHERE username ~ '[^\x00-\x7F]';

  -- Only installs that already hold a non-ASCII username depend on the database
  -- being able to fold one. Those names could only have been created by an
  -- admin, before either /api/users endpoint validated anything.
  IF non_ascii > 0 THEN
    -- normalize() is PostgreSQL 13+. Below that the backfill cannot produce the
    -- NFC form the application will compare against.
    IF current_setting('server_version_num')::int < 130000 THEN
      RAISE EXCEPTION USING MESSAGE =
        'This database holds ' || non_ascii || ' username(s) with non-ASCII characters, '
        || 'and normalize() needs PostgreSQL 13 or newer to fold them. '
        || 'Upgrade PostgreSQL, or rename those accounts to ASCII, then start again. '
        || 'Nothing has been changed.';
    END IF;

    -- lc_ctype=C lowercases only ASCII, so the backfill would store a value the
    -- application never produces and those users could not log in.
    IF lower('Ä') <> 'ä' THEN
      RAISE EXCEPTION USING MESSAGE =
        'This database holds ' || non_ascii || ' username(s) with non-ASCII characters, '
        || 'but its collation (lc_ctype=' || current_setting('lc_ctype') || ') does not '
        || 'lowercase them, so they cannot be folded correctly. '
        || 'Re-initialise the database with a UTF-8 locale, or rename those accounts '
        || 'to ASCII, then start again. Nothing has been changed.';
    END IF;
  END IF;

  -- Two accounts that fold to one name cannot both survive a unique index. This
  -- is reachable: before the admin endpoints validated anything, `Müller` and
  -- `müller` could both be created, and the old lower(username) index would not
  -- have collided them on a C-locale install. Refusing and naming them is right
  -- - picking a winner would silently lock somebody out of their account.
  SELECT string_agg(folded, ', ') INTO conflict
    FROM (SELECT lower(normalize(username, NFC)) AS folded
            FROM users GROUP BY 1 HAVING count(*) > 1) duplicates;

  IF conflict IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE =
      'These usernames differ only by case or Unicode spelling and would collide '
      || 'once usernames are compared folded: ' || conflict || '. '
      || 'Rename all but one of each, then start again. Nothing has been changed.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username_folded" text;--> statement-breakpoint
UPDATE "users" SET "username_folded" = lower(normalize("username", NFC));--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username_folded" SET NOT NULL;--> statement-breakpoint
DROP INDEX "users_username_lower_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_folded_idx" ON "users" USING btree ("username_folded");
