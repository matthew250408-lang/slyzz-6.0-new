import {
  integer,
  pgTable,
  timestamp,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const modmailConversationsTable = pgTable(
  "modmail_conversations",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: varchar("user_id", { length: 32 }).notNull(),
    threadId: varchar("thread_id", { length: 32 }).notNull(),
    claimedByUserId: varchar("claimed_by_user_id", { length: 32 }),
    reviewRating: integer("review_rating"),
    reviewText: text("review_text"),
    reviewMessageId: varchar("review_message_id", { length: 32 }),
    status: varchar("status", { length: 16 })
      .$type<"open" | "claimed" | "closed">()
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    threadIdUnique: uniqueIndex("modmail_conversations_thread_id_unique").on(
      table.threadId,
    ),
  }),
);

export type ModmailConversation =
  typeof modmailConversationsTable.$inferSelect;