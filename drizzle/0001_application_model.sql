CREATE TYPE "public"."diagram_change_origin" AS ENUM('manual', 'mcp', 'restore');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('view', 'edit');--> statement-breakpoint
CREATE TYPE "public"."relationship_cardinality" AS ENUM('zero_or_one', 'one', 'zero_or_many', 'one_or_many');--> statement-breakpoint
CREATE TABLE "diagram" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagram_revision_nonnegative" CHECK ("diagram"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "diagram_attribute" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"data_type" text NOT NULL,
	"description" text,
	"is_nullable" boolean DEFAULT true NOT NULL,
	"is_primary_key" boolean DEFAULT false NOT NULL,
	"is_unique" boolean DEFAULT false NOT NULL,
	"default_value" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "diagram_attribute_entity_name_unique" UNIQUE("entity_id","name"),
	CONSTRAINT "diagram_attribute_name_not_blank" CHECK (btrim("diagram_attribute"."name") <> ''),
	CONSTRAINT "diagram_attribute_data_type_not_blank" CHECK (btrim("diagram_attribute"."data_type") <> ''),
	CONSTRAINT "diagram_attribute_sort_order_nonnegative" CHECK ("diagram_attribute"."sort_order" >= 0),
	CONSTRAINT "diagram_attribute_primary_key_not_nullable" CHECK (NOT "diagram_attribute"."is_primary_key" OR NOT "diagram_attribute"."is_nullable")
);
--> statement-breakpoint
CREATE TABLE "diagram_entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position_x" double precision DEFAULT 0 NOT NULL,
	"position_y" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "diagram_entity_project_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "diagram_entity_name_not_blank" CHECK (btrim("diagram_entity"."name") <> ''),
	CONSTRAINT "diagram_entity_position_finite" CHECK ("diagram_entity"."position_x" > '-Infinity'::float8 AND "diagram_entity"."position_x" < 'Infinity'::float8 AND "diagram_entity"."position_y" > '-Infinity'::float8 AND "diagram_entity"."position_y" < 'Infinity'::float8)
);
--> statement-breakpoint
CREATE TABLE "diagram_relationship" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"label" text,
	"description" text,
	"source_cardinality" "relationship_cardinality" NOT NULL,
	"target_cardinality" "relationship_cardinality" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagram_revision" (
	"project_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"actor_user_id" text,
	"origin" "diagram_change_origin" NOT NULL,
	"summary" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"restored_from_revision" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagram_revision_project_id_revision_pk" PRIMARY KEY("project_id","revision"),
	CONSTRAINT "diagram_revision_positive" CHECK ("diagram_revision"."revision" > 0),
	CONSTRAINT "diagram_revision_summary_not_blank" CHECK (btrim("diagram_revision"."summary") <> ''),
	CONSTRAINT "diagram_revision_snapshot_shape" CHECK ((jsonb_typeof("diagram_revision"."snapshot") = 'object' AND "diagram_revision"."snapshot" @> '{"schemaVersion": 1}'::jsonb AND jsonb_typeof("diagram_revision"."snapshot"->'entities') = 'array' AND jsonb_typeof("diagram_revision"."snapshot"->'attributes') = 'array' AND jsonb_typeof("diagram_revision"."snapshot"->'relationships') = 'array') IS TRUE),
	CONSTRAINT "diagram_revision_restore_origin" CHECK (("diagram_revision"."origin" = 'restore') = ("diagram_revision"."restored_from_revision" IS NOT NULL)),
	CONSTRAINT "diagram_revision_restore_precedes_revision" CHECK ("diagram_revision"."restored_from_revision" > 0 AND "diagram_revision"."restored_from_revision" < "diagram_revision"."revision")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_name_not_blank" CHECK (btrim("project"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "project_invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "project_role" NOT NULL,
	"invited_by_user_id" text,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_invitation_project_email_unique" UNIQUE("project_id","email"),
	CONSTRAINT "project_invitation_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "project_invitation_email_normalized" CHECK ("project_invitation"."email" = lower(btrim("project_invitation"."email")) AND "project_invitation"."email" <> ''),
	CONSTRAINT "project_invitation_token_hash_not_blank" CHECK (btrim("project_invitation"."token_hash") <> ''),
	CONSTRAINT "project_invitation_expiry_after_creation" CHECK ("project_invitation"."expires_at" > "project_invitation"."created_at")
);
--> statement-breakpoint
CREATE TABLE "project_mcp_lease" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"lease_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "project_mcp_lease_id_unique" UNIQUE("lease_id"),
	CONSTRAINT "project_mcp_lease_expiry_after_acquisition" CHECK ("project_mcp_lease"."expires_at" > "project_mcp_lease"."acquired_at")
);
--> statement-breakpoint
CREATE TABLE "project_member" (
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "project_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_member_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_owner_user_unique" UNIQUE("owner_user_id"),
	CONSTRAINT "workspace_name_not_blank" CHECK (btrim("workspace"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "diagram" ADD CONSTRAINT "diagram_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_attribute" ADD CONSTRAINT "diagram_attribute_entity_id_diagram_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."diagram_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_entity" ADD CONSTRAINT "diagram_entity_project_id_diagram_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."diagram"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_relationship" ADD CONSTRAINT "diagram_relationship_source_fk" FOREIGN KEY ("project_id","source_entity_id") REFERENCES "public"."diagram_entity"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_relationship" ADD CONSTRAINT "diagram_relationship_target_fk" FOREIGN KEY ("project_id","target_entity_id") REFERENCES "public"."diagram_entity"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_revision" ADD CONSTRAINT "diagram_revision_project_id_diagram_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."diagram"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_revision" ADD CONSTRAINT "diagram_revision_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_revision" ADD CONSTRAINT "diagram_revision_restored_from_fk" FOREIGN KEY ("project_id","restored_from_revision") REFERENCES "public"."diagram_revision"("project_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invitation" ADD CONSTRAINT "project_invitation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invitation" ADD CONSTRAINT "project_invitation_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_mcp_lease" ADD CONSTRAINT "project_mcp_lease_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_mcp_lease" ADD CONSTRAINT "project_mcp_lease_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagram_relationship_source_idx" ON "diagram_relationship" USING btree ("project_id","source_entity_id");--> statement-breakpoint
CREATE INDEX "diagram_relationship_target_idx" ON "diagram_relationship" USING btree ("project_id","target_entity_id");--> statement-breakpoint
CREATE INDEX "diagram_revision_actor_user_id_idx" ON "diagram_revision" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "project_workspace_id_idx" ON "project" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "project_invitation_email_idx" ON "project_invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "project_invitation_invited_by_idx" ON "project_invitation" USING btree ("invited_by_user_id");--> statement-breakpoint
CREATE INDEX "project_mcp_lease_user_id_idx" ON "project_mcp_lease" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_member_user_id_idx" ON "project_member" USING btree ("user_id");