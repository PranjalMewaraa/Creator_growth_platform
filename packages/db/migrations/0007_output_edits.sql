CREATE TABLE "output_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"output_id" uuid NOT NULL,
	"distance" integer NOT NULL,
	"rate" real NOT NULL,
	"generated_chars" integer NOT NULL,
	"accepted_chars" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "output_edits" ADD CONSTRAINT "output_edits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_edits" ADD CONSTRAINT "output_edits_output_id_outputs_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."outputs"("id") ON DELETE no action ON UPDATE no action;