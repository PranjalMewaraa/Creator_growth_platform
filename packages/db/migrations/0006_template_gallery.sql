ALTER TABLE "template_previews" ALTER COLUMN "media_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "template_previews" ADD COLUMN "text" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "template_previews" ADD CONSTRAINT "template_previews_once" UNIQUE("template_version_id");--> statement-breakpoint
ALTER TABLE "template_previews" ADD CONSTRAINT "template_previews_has_content" CHECK ("template_previews"."media_url" IS NOT NULL OR "template_previews"."text" IS NOT NULL);