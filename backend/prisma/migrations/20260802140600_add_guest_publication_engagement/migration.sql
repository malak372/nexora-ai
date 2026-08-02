-- Allow publication engagement to be owned by either:
-- 1. A registered user.
-- 2. A secure guest session.

-- Publication votes

ALTER TABLE "idea_publication_votes"
  ALTER COLUMN "user_id" DROP NOT NULL,
  ADD COLUMN "guest_session_id" TEXT;

-- Publication ratings

ALTER TABLE "idea_publication_ratings"
  ALTER COLUMN "user_id" DROP NOT NULL,
  ADD COLUMN "guest_session_id" TEXT;

-- Publication feedback

ALTER TABLE "idea_publication_feedback"
  ALTER COLUMN "user_id" DROP NOT NULL,
  ADD COLUMN "guest_session_id" TEXT;

-- Guest-session foreign keys

ALTER TABLE "idea_publication_votes"
  ADD CONSTRAINT "idea_publication_votes_guest_session_id_fkey"
  FOREIGN KEY ("guest_session_id")
  REFERENCES "guest_sessions"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "idea_publication_ratings"
  ADD CONSTRAINT "idea_publication_ratings_guest_session_id_fkey"
  FOREIGN KEY ("guest_session_id")
  REFERENCES "guest_sessions"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "idea_publication_feedback"
  ADD CONSTRAINT "idea_publication_feedback_guest_session_id_fkey"
  FOREIGN KEY ("guest_session_id")
  REFERENCES "guest_sessions"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- Prevent duplicate guest engagement

CREATE UNIQUE INDEX
  "idea_publication_votes_publication_id_guest_session_id_key"
ON "idea_publication_votes"(
  "publication_id",
  "guest_session_id"
);

CREATE UNIQUE INDEX
  "idea_publication_ratings_publication_id_guest_session_id_key"
ON "idea_publication_ratings"(
  "publication_id",
  "guest_session_id"
);

CREATE UNIQUE INDEX
  "idea_publication_feedback_publication_id_guest_session_id_key"
ON "idea_publication_feedback"(
  "publication_id",
  "guest_session_id"
);

-- Guest-session lookup indexes

CREATE INDEX "idea_publication_votes_guest_session_id_idx"
ON "idea_publication_votes"("guest_session_id");

CREATE INDEX "idea_publication_ratings_guest_session_id_idx"
ON "idea_publication_ratings"("guest_session_id");

CREATE INDEX "idea_publication_feedback_guest_session_id_idx"
ON "idea_publication_feedback"("guest_session_id");

-- Ownership validation

ALTER TABLE "idea_publication_votes"
  ADD CONSTRAINT "idea_publication_votes_owner_check"
  CHECK (
    ("user_id" IS NOT NULL)
    <>
    ("guest_session_id" IS NOT NULL)
  );

ALTER TABLE "idea_publication_ratings"
  ADD CONSTRAINT "idea_publication_ratings_owner_check"
  CHECK (
    ("user_id" IS NOT NULL)
    <>
    ("guest_session_id" IS NOT NULL)
  );

ALTER TABLE "idea_publication_feedback"
  ADD CONSTRAINT "idea_publication_feedback_owner_check"
  CHECK (
    ("user_id" IS NOT NULL)
    <>
    ("guest_session_id" IS NOT NULL)
  );