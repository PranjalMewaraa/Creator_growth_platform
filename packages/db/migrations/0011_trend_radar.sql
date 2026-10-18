CREATE TYPE "public"."trend_lifecycle_stage" AS ENUM('rising', 'peak', 'evergreen', 'decaying');--> statement-breakpoint
CREATE TYPE "public"."trend_source" AS ENUM('youtube', 'autocomplete', 'reddit', 'blended');--> statement-breakpoint
CREATE TABLE "trend_bookmarks" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"trend_id" uuid NOT NULL,
	"used_in_script" boolean DEFAULT false NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trend_bookmarks_workspace_id_user_id_trend_id_pk" PRIMARY KEY("workspace_id","user_id","trend_id")
);
--> statement-breakpoint
CREATE TABLE "trending_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"niche" text NOT NULL,
	"region" text DEFAULT 'global' NOT NULL,
	"topic_title" text NOT NULL,
	"search_volume_indicator" text,
	"velocity_score" integer DEFAULT 50 NOT NULL,
	"lifecycle_stage" "trend_lifecycle_stage" DEFAULT 'rising' NOT NULL,
	"source_platform" "trend_source" NOT NULL,
	"summary" text NOT NULL,
	"creative_angles" jsonb NOT NULL,
	"suggested_hooks" text[] DEFAULT '{}' NOT NULL,
	"recommended_tags" jsonb NOT NULL,
	"estimated_lifespan" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trending_topics_dedupe" UNIQUE("niche","region","topic_title"),
	CONSTRAINT "trending_topics_velocity_range" CHECK ("trending_topics"."velocity_score" >= 1 AND "trending_topics"."velocity_score" <= 100)
);
--> statement-breakpoint
ALTER TABLE "trend_bookmarks" ADD CONSTRAINT "trend_bookmarks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_bookmarks" ADD CONSTRAINT "trend_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_bookmarks" ADD CONSTRAINT "trend_bookmarks_trend_id_trending_topics_id_fk" FOREIGN KEY ("trend_id") REFERENCES "public"."trending_topics"("id") ON DELETE cascade ON UPDATE no action;