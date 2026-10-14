import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const inscriptionConfigsTable = pgTable(
  "inscription_configs",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    messageContent: text("message_content").notNull(),
    embedTitle: varchar("embed_title", { length: 256 })
      .notNull()
      .default("🎫 Inscription"),
    buttonLabel: varchar("button_label", { length: 80 }).notNull(),
    authorizedUserIds: jsonb("authorized_user_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    questions: jsonb("questions").$type<string[]>().notNull().default([]),
    customQuestions: jsonb("custom_questions")
      .$type<string[]>()
      .notNull()
      .default([]),
    responseChannelId: varchar("response_channel_id", { length: 32 }),
    registrationChannelId: varchar("registration_channel_id", { length: 32 }),
    registrationMessageId: varchar("registration_message_id", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    guildIdUnique: uniqueIndex("inscription_configs_guild_id_unique").on(
      table.guildId,
    ),
  }),
);

export const insertInscriptionConfigSchema = z.object({
  guildId: z.string().min(1),
  messageContent: z.string().min(1),
  embedTitle: z.string().min(1).max(256),
  buttonLabel: z.string().min(1),
  authorizedUserIds: z.array(z.string()),
  questions: z.array(z.string()),
  responseChannelId: z.string().nullable().optional(),
  registrationChannelId: z.string().nullable().optional(),
  registrationMessageId: z.string().nullable().optional(),
});

export type InsertInscriptionConfig = z.infer<
  typeof insertInscriptionConfigSchema
>;
export type InscriptionConfig = typeof inscriptionConfigsTable.$inferSelect;