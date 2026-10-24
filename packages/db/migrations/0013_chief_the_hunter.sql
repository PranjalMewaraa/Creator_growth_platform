ALTER TABLE "storyboard_scenes" ADD COLUMN "video_duration_seconds" real;--> statement-breakpoint
ALTER TABLE "storyboards" ADD COLUMN "final_video_url" text;--> statement-breakpoint
ALTER TABLE "storyboards" ADD COLUMN "final_output_id" uuid;--> statement-breakpoint
ALTER TABLE "storyboards" ADD COLUMN "final_job_id" uuid;--> statement-breakpoint
ALTER TABLE "storyboards" ADD CONSTRAINT "storyboards_final_output_id_outputs_id_fk" FOREIGN KEY ("final_output_id") REFERENCES "public"."outputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboards" ADD CONSTRAINT "storyboards_final_job_id_jobs_id_fk" FOREIGN KEY ("final_job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;