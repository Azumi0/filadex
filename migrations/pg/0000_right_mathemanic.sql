CREATE TABLE "api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now(),
	"last_used_at" timestamp,
	CONSTRAINT "api_tokens_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "catalog_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "colors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_filament_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"manufacturer" text NOT NULL,
	"material" text NOT NULL,
	"name" text NOT NULL,
	"color_name" text NOT NULL,
	"color_code" text,
	"density" numeric,
	"diameter" numeric,
	"extruder_temp" integer,
	"bed_temp" integer,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"entity_type" text DEFAULT 'filament' NOT NULL,
	"name" text NOT NULL,
	"field_type" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "diameters" (
	"id" serial PRIMARY KEY NOT NULL,
	"value" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diameters_value_key" UNIQUE("value")
);
--> statement-breakpoint
CREATE TABLE "email_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false,
	"smtp_host" text,
	"smtp_port" integer,
	"smtp_user" text,
	"smtp_password" text,
	"smtp_secure" boolean DEFAULT true,
	"from_email" text,
	"from_name" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "filament_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"manufacturer" text,
	"material" text NOT NULL,
	"color_name" text NOT NULL,
	"color_code" text,
	"diameter" numeric,
	"print_temp" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "filament_usage_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"filament_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"delta_weight" numeric NOT NULL,
	"remaining_percentage_after" numeric NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "filaments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"filament_type_id" integer NOT NULL,
	"name" text NOT NULL,
	"total_weight" numeric NOT NULL,
	"remaining_percentage" numeric NOT NULL,
	"purchase_date" date,
	"purchase_price" numeric,
	"status" text,
	"spool_type" text,
	"dryer_count" integer DEFAULT 0 NOT NULL,
	"last_drying_date" date,
	"storage_location" text,
	"low_stock_notified_at" timestamp,
	"drying_reminder_notified_at" timestamp,
	"custom_field_values" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "manufacturers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 999,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manufacturers_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 999,
	"density" numeric,
	"is_hygroscopic" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "storage_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 999,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_locations_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_sharing" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"material_id" integer,
	"is_public" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"is_admin" boolean DEFAULT false,
	"role" text DEFAULT 'user' NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false,
	"email_verification_token" text,
	"email_verification_expires" timestamp,
	"password_reset_token" text,
	"password_reset_expires" timestamp,
	"force_change_password" boolean DEFAULT true,
	"language" text DEFAULT 'en',
	"currency" text DEFAULT 'EUR',
	"temperature_unit" text DEFAULT 'C',
	"last_login" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"low_stock_threshold_percent" integer DEFAULT 15,
	"notify_low_stock" boolean DEFAULT true,
	"notify_drying_reminder" boolean DEFAULT true,
	"drying_reminder_days" integer DEFAULT 30,
	"theme_variant" text DEFAULT 'professional',
	"theme_primary" text DEFAULT '#EA580C',
	"theme_appearance" text DEFAULT 'dark',
	"theme_radius" numeric DEFAULT '0.8',
	CONSTRAINT "users_username_key" UNIQUE("username"),
	CONSTRAINT "users_email_key" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_requests" ADD CONSTRAINT "catalog_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_requests" ADD CONSTRAINT "catalog_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filament_types" ADD CONSTRAINT "filament_types_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filament_usage_log" ADD CONSTRAINT "filament_usage_log_filament_id_fkey" FOREIGN KEY ("filament_id") REFERENCES "public"."filaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filament_usage_log" ADD CONSTRAINT "filament_usage_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filaments" ADD CONSTRAINT "filaments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filaments" ADD CONSTRAINT "filaments_filament_type_id_fkey" FOREIGN KEY ("filament_type_id") REFERENCES "public"."filament_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sharing" ADD CONSTRAINT "user_sharing_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sharing" ADD CONSTRAINT "user_sharing_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_filament_cache_search_idx" ON "community_filament_cache" USING btree ("manufacturer","name","color_name");--> statement-breakpoint
CREATE INDEX "filament_usage_log_filament_id_idx" ON "filament_usage_log" USING btree ("filament_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_idx" ON "users" USING btree (lower("username"));