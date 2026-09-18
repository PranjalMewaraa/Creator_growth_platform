-- Hand edited: the unique constraint moves before the foreign key that references it.
DROP INDEX "compiler_profiles_version";--> statement-breakpoint
ALTER TABLE "compiler_profiles" ADD CONSTRAINT "compiler_profiles_version" UNIQUE("key","version");
--> statement-breakpoint
ALTER TABLE "compiled_prompts" ADD COLUMN "compiler_profile_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "compiled_prompts" ADD COLUMN "output_type" "output_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "compiled_prompts" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "compiled_prompts" ADD COLUMN "settings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "compiled_prompts" ADD CONSTRAINT "compiled_prompts_compiler_profile_fk" FOREIGN KEY ("compiler_profile_key","compiler_profile_version") REFERENCES "public"."compiler_profiles"("key","version") ON DELETE no action ON UPDATE no action;