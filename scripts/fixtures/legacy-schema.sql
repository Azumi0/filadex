-- The schema docker-entrypoint.sh created before this project moved to
-- generated migrations, frozen here verbatim.
--
-- This is not run by the application. It exists so scripts/legacy-db.ts can
-- rebuild the database an existing installation upgrades *from*, which is what
-- scripts/verify-upgrade.ts checks the upgrade against. Do not edit it: it
-- describes what deployments actually ran, and changing it would only make the
-- upgrade test agree with a fiction.

  CREATE SCHEMA IF NOT EXISTS public;

  -- Only create tables if they don't exist
  -- DO NOT execute DROP commands to preserve data

  -- Create tables

  CREATE TABLE IF NOT EXISTS public.users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    force_change_password BOOLEAN DEFAULT TRUE,
    language TEXT DEFAULT 'en',
    currency TEXT DEFAULT 'EUR',
    temperature_unit TEXT DEFAULT 'C',
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
  );



  CREATE TABLE IF NOT EXISTS public.manufacturers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 999,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
  );

  CREATE TABLE IF NOT EXISTS public.materials (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 999,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
  );

  CREATE TABLE IF NOT EXISTS public.colors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
  );

  CREATE TABLE IF NOT EXISTS public.diameters (
    id SERIAL PRIMARY KEY,
    value NUMERIC NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
  );

  CREATE TABLE IF NOT EXISTS public.storage_locations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 999,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
  );

  CREATE TABLE IF NOT EXISTS public.filaments (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    manufacturer TEXT,
    material TEXT NOT NULL,
    color_name TEXT,
    color_code TEXT,
    diameter NUMERIC,
    print_temp TEXT,
    total_weight NUMERIC NOT NULL,
    remaining_percentage NUMERIC NOT NULL,
    purchase_date DATE,
    purchase_price NUMERIC,
    status TEXT,
    spool_type TEXT,
    dryer_count INTEGER DEFAULT 0 NOT NULL,
    last_drying_date DATE,
    storage_location TEXT,
    user_id INTEGER REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.user_sharing (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    material_id INTEGER REFERENCES public.materials(id) ON DELETE CASCADE,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
  );
