DROP INDEX "renditions_once_per_platform";--> statement-breakpoint
ALTER TABLE "renditions" ADD COLUMN "kind" text DEFAULT 'layer' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "renditions_once_per_platform" ON "renditions" USING btree ("output_id","platform","kind");