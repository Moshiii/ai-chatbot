DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'
  ) THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END$$;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS auth;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION auth.user_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT current_setting('request.jwt.claims', true)::json->>'sub'
$$;
--> statement-breakpoint
CREATE TABLE "chat" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp NOT NULL,
	"title" text NOT NULL,
	"userId" uuid NOT NULL,
	"visibility" varchar NOT NULL,
	"ownerId" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid NOT NULL,
	"createdAt" timestamp NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"kind" varchar NOT NULL,
	"userId" uuid NOT NULL,
	"taskIds" jsonb,
	"ownerId" text NOT NULL,
	CONSTRAINT "document_id_createdAt_pk" PRIMARY KEY("id","createdAt")
);
--> statement-breakpoint
ALTER TABLE "document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chatId" uuid NOT NULL,
	"role" varchar NOT NULL,
	"parts" json NOT NULL,
	"attachments" json NOT NULL,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stream" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chatId" uuid NOT NULL,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggestion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"documentId" uuid NOT NULL,
	"documentCreatedAt" timestamp NOT NULL,
	"originalText" text NOT NULL,
	"suggestedText" text NOT NULL,
	"description" text,
	"isResolved" boolean NOT NULL,
	"userId" uuid NOT NULL,
	"createdAt" timestamp NOT NULL,
	"ownerId" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suggestion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task" (
	"id" text PRIMARY KEY NOT NULL,
	"contextId" text NOT NULL,
	"status" varchar NOT NULL,
	"statusMessage" text,
	"result" jsonb,
	"webhookToken" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(64) NOT NULL,
	"password" varchar(64),
	"creditBalance" varchar(20) NOT NULL,
	"name" varchar(255),
	"image" text,
	"emailVerified" timestamp,
	"stackUserId" text,
	CONSTRAINT "user_email_idx" UNIQUE("email"),
	CONSTRAINT "user_stackUserId_idx" UNIQUE("stackUserId")
);
--> statement-breakpoint
CREATE TABLE "vote" (
	"id" uuid PRIMARY KEY NOT NULL,
	"messageId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"chatId" uuid,
	"value" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"ownerId" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vote" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_chatId_chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chat"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream" ADD CONSTRAINT "stream_chatId_chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chat"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_documentId_documentCreatedAt_document_id_createdAt_fk" FOREIGN KEY ("documentId","documentCreatedAt") REFERENCES "public"."document"("id","createdAt") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_messageId_message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_userId_idx" ON "chat" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "chat_createdAt_idx" ON "chat" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "chat_ownerId_idx" ON "chat" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "document_userId_idx" ON "document" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "document_kind_idx" ON "document" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "document_ownerId_idx" ON "document" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "message_chatId_idx" ON "message" USING btree ("chatId");--> statement-breakpoint
CREATE INDEX "message_createdAt_idx" ON "message" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "stream_chatId_idx" ON "stream" USING btree ("chatId");--> statement-breakpoint
CREATE INDEX "suggestion_userId_idx" ON "suggestion" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "suggestion_documentId_idx" ON "suggestion" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "suggestion_ownerId_idx" ON "suggestion" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "task_contextId_idx" ON "task" USING btree ("contextId");--> statement-breakpoint
CREATE INDEX "task_status_idx" ON "task" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vote_messageId_idx" ON "vote" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "vote_userId_idx" ON "vote" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "vote_ownerId_idx" ON "vote" USING btree ("ownerId");--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "chat" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "chat"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "chat" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "chat"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "chat" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "chat"."ownerId")) WITH CHECK ((select auth.user_id() = "chat"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "chat" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "chat"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "document" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "document"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "document" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "document"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "document" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "document"."ownerId")) WITH CHECK ((select auth.user_id() = "document"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "document" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "document"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "suggestion" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "suggestion"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "suggestion" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "suggestion"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "suggestion" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "suggestion"."ownerId")) WITH CHECK ((select auth.user_id() = "suggestion"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "suggestion" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "suggestion"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vote" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "vote"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vote" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "vote"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vote" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "vote"."ownerId")) WITH CHECK ((select auth.user_id() = "vote"."ownerId"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vote" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "vote"."ownerId"));