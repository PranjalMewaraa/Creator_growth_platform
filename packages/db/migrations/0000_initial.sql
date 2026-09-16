CREATE TYPE "public"."currency" AS ENUM('credits', 'video_seconds');--> statement-breakpoint
CREATE TYPE "public"."job_class" AS ENUM('inference', 'render', 'publish');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('QUEUED', 'RUNNING', 'MODERATING', 'COMPLETE', 'BLOCKED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."ledger_reason" AS ENUM('hold', 'settle', 'refund', 'grant');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'editor');--> statement-breakpoint
CREATE TYPE "public"."output_type" AS ENUM('script', 'hook', 'caption', 'image', 'thumbnail', 'video');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('instagram', 'linkedin');--> statement-breakpoint
CREATE TYPE "public"."post_target_status" AS ENUM('pending', 'claimed', 'published', 'retry_scheduled', 'quota_wait', 'reauth_required', 'failed', 'needs_verification');--> statement-breakpoint
CREATE TABLE "compiler_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"output_type" "output_type" NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metering_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"credits" jsonb NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metering_rates_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "music_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"storage_key" text NOT NULL,
	"licence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_version_id" uuid NOT NULL,
	"media_url" text NOT NULL,
	"is_real_output" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_previews_real_output_only" CHECK ("template_previews"."is_real_output")
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"aspect_ratio" text NOT NULL,
	"model_tier" text NOT NULL,
	"compiler_profile_ref" text NOT NULL,
	"style_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"post_processing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_band" text NOT NULL,
	"video_defaults" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_versions_version" UNIQUE("template_id","version")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"output_type" "output_type" NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "compiled_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid,
	"parent_id" uuid,
	"text" text NOT NULL,
	"intent_text" text NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"profile_version" integer NOT NULL,
	"brand_kit_version" integer NOT NULL,
	"compiler_profile_version" integer NOT NULL,
	"user_edited" boolean DEFAULT false NOT NULL,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_events_subject" CHECK (subject_type IN ('compiled_prompt', 'output')),
	CONSTRAINT "moderation_events_verdict" CHECK (verdict IN ('allowed', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" "output_type" NOT NULL,
	"storage_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compiled_prompt_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"brand_kit_version" integer NOT NULL,
	"parent_output_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"output_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"spec" jsonb NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"output_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"clip_url" text,
	"duration_s" real,
	"prompt" text NOT NULL,
	"regenerated_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"action_class" text NOT NULL,
	"provider" text NOT NULL,
	"realised_cost_inr" numeric(12, 4) NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid,
	"currency" "currency" NOT NULL,
	"delta" integer NOT NULL,
	"reason" "ledger_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_job_required" CHECK (reason = 'grant' OR job_id IS NOT NULL),
	CONSTRAINT "credit_ledger_delta_sign" CHECK (CASE reason WHEN 'hold' THEN delta < 0 WHEN 'settle' THEN delta >= 0 ELSE delta > 0 END)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_class" "job_class" NOT NULL,
	"generator_key" text NOT NULL,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"credits_held" integer DEFAULT 0 NOT NULL,
	"credits_settled" integer,
	"video_seconds_held" integer DEFAULT 0 NOT NULL,
	"video_seconds_settled" integer,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_holds_non_negative" CHECK ("jobs"."credits_held" >= 0 AND "jobs"."video_seconds_held" >= 0)
);
--> statement-breakpoint
CREATE TABLE "post_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"status" "post_target_status" DEFAULT 'pending' NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rendition_id" uuid,
	"prepared_ref" text,
	"platform_post_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" jsonb,
	"claimed_at" timestamp with time zone,
	"publish_started_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_targets_published_has_post_id" CHECK (status <> 'published' OR platform_post_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"source_output_id" uuid,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"recurrence_rule" text NOT NULL,
	"pillar" text,
	"platform" "platform" NOT NULL,
	"time_of_day" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"token_ciphertext" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"health" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"logo_url" text,
	"colors" text[] DEFAULT '{}' NOT NULL,
	"typography" text,
	"tagline" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_kits_version" UNIQUE("workspace_id","version"),
	CONSTRAINT "brand_kits_three_colours_max" CHECK (cardinality("brand_kits"."colors") <= 3)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_types" text[] DEFAULT '{}' NOT NULL,
	"platforms" text[] DEFAULT '{}' NOT NULL,
	"team_shape" text,
	"goal_90d" text,
	"cadence" text,
	"pillars" text[] DEFAULT '{}' NOT NULL,
	"tone" text,
	"language" text DEFAULT 'en' NOT NULL,
	"prohibited_words" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_profiles_version" UNIQUE("workspace_id","version")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"credit_balance" integer DEFAULT 0 NOT NULL,
	"video_seconds_balance" integer DEFAULT 0 NOT NULL,
	"video_seconds_cap" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_balances_non_negative" CHECK ("workspaces"."credit_balance" >= 0 AND "workspaces"."video_seconds_balance" >= 0)
);
--> statement-breakpoint
ALTER TABLE "template_previews" ADD CONSTRAINT "template_previews_template_version_id_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compiled_prompts" ADD CONSTRAINT "compiled_prompts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compiled_prompts" ADD CONSTRAINT "compiled_prompts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compiled_prompts" ADD CONSTRAINT "compiled_prompts_parent_id_compiled_prompts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."compiled_prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compiled_prompts" ADD CONSTRAINT "compiled_prompts_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compiled_prompts" ADD CONSTRAINT "compiled_prompts_template_version_fk" FOREIGN KEY ("template_id","template_version") REFERENCES "public"."template_versions"("template_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compiled_prompts" ADD CONSTRAINT "compiled_prompts_profile_version_fk" FOREIGN KEY ("workspace_id","profile_version") REFERENCES "public"."workspace_profiles"("workspace_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compiled_prompts" ADD CONSTRAINT "compiled_prompts_brand_kit_version_fk" FOREIGN KEY ("workspace_id","brand_kit_version") REFERENCES "public"."brand_kits"("workspace_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outputs" ADD CONSTRAINT "outputs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outputs" ADD CONSTRAINT "outputs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outputs" ADD CONSTRAINT "outputs_compiled_prompt_id_compiled_prompts_id_fk" FOREIGN KEY ("compiled_prompt_id") REFERENCES "public"."compiled_prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outputs" ADD CONSTRAINT "outputs_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outputs" ADD CONSTRAINT "outputs_parent_output_id_outputs_id_fk" FOREIGN KEY ("parent_output_id") REFERENCES "public"."outputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renditions" ADD CONSTRAINT "renditions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renditions" ADD CONSTRAINT "renditions_output_id_outputs_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."outputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_output_id_outputs_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."outputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_telemetry" ADD CONSTRAINT "cost_telemetry_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_telemetry" ADD CONSTRAINT "cost_telemetry_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_rendition_id_renditions_id_fk" FOREIGN KEY ("rendition_id") REFERENCES "public"."renditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_source_output_id_outputs_id_fk" FOREIGN KEY ("source_output_id") REFERENCES "public"."outputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_profiles" ADD CONSTRAINT "workspace_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "compiler_profiles_version" ON "compiler_profiles" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "compiled_prompts_job" ON "compiled_prompts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "moderation_events_subject_idx" ON "moderation_events" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "outputs_workspace_created" ON "outputs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "renditions_once_per_platform" ON "renditions" USING btree ("output_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "video_scenes_order" ON "video_scenes" USING btree ("output_id","index");--> statement-breakpoint
CREATE INDEX "cost_telemetry_job" ON "cost_telemetry" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_once_per_job" ON "credit_ledger" USING btree ("job_id","currency","reason") WHERE reason <> 'grant';--> statement-breakpoint
CREATE INDEX "credit_ledger_workspace_currency" ON "credit_ledger" USING btree ("workspace_id","currency");--> statement-breakpoint
CREATE INDEX "jobs_workspace_created" ON "jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_status" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "post_targets_one_per_account" ON "post_targets" USING btree ("publication_id","social_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_targets_platform_post" ON "post_targets" USING btree ("social_account_id","platform_post_id") WHERE platform_post_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "post_targets_status" ON "post_targets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "publications_workspace_scheduled" ON "publications" USING btree ("workspace_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_identity" ON "social_accounts" USING btree ("workspace_id","platform","external_id");