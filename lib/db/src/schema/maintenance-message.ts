import {
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export type MaintenanceMessageKind = "status" | "support" | "staff-absence";

export const maintenanceMessagesTable = pgTable(
  "maintenance_messages",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    kind: varchar("kind", { length: 20 })
      .$type<MaintenanceMessageKind>()
      .notNull(),
    channelId: varchar("channel_id", { length: 32 }).notNull(),
    messageId: varchar("message_id", { length: 32 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    guildKindUnique: uniqueIndex("maintenance_messages_guild_kind_unique").on(
      table.guildId,
      table.kind,
    ),
  }),
);

export type MaintenanceMessageReference =
  typeof maintenanceMessagesTable.$inferSelect;
