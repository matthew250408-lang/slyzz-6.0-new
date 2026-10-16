import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const countingGameTable = pgTable("counting_game", {
  channelId: varchar("channel_id", { length: 32 }).primaryKey(),
  currentCount: text("current_count").default("0").notNull(),
  lastUserId: varchar("last_user_id", { length: 32 }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
