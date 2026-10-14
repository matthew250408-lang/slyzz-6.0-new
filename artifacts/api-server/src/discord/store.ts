import { eq } from "drizzle-orm";
import {
  db,
  inscriptionConfigsTable,
  type InscriptionConfig,
} from "@workspace/db";
import {
  AVAILABLE_QUESTIONS,
  DEFAULT_BUTTON_LABEL,
  DEFAULT_EMBED_TITLE,
  DEFAULT_MESSAGE,
  DEFAULT_RECRUITMENT_QUESTIONS,
  LEGACY_DEFAULT_BUTTON_LABEL,
  LEGACY_DEFAULT_EMBED_TITLE,
  LEGACY_DEFAULT_MESSAGE,
} from "./constants";

export type InscriptionConfigData = {
  messageContent: string;
  embedTitle: string;
  buttonLabel: string;
  authorizedUserIds: string[];
  questions: string[];
  customQuestions: string[];
  responseChannelId: string | null;
  registrationChannelId: string | null;
  registrationMessageId: string | null;
};

const defaultConfig: InscriptionConfigData = {
  messageContent: DEFAULT_MESSAGE,
  embedTitle: DEFAULT_EMBED_TITLE,
  buttonLabel: DEFAULT_BUTTON_LABEL,
  authorizedUserIds: [],
  questions: [...DEFAULT_RECRUITMENT_QUESTIONS],
  customQuestions: [],
  responseChannelId: null,
  registrationChannelId: null,
  registrationMessageId: null,
};

function normalizeQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const builtInQuestionIds = new Set<string>(
    AVAILABLE_QUESTIONS.map((question) => question.id),
  );

  return value.filter(
    (question): question is string =>
      typeof question === "string" &&
      (builtInQuestionIds.has(question) || question.startsWith("custom:")),
  );
}

function normalizeCustomQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter((question): question is string => typeof question === "string")
        .map((question) => question.trim().replace(/\s+/g, " ").slice(0, 80))
        .filter(Boolean),
    ),
  ];
}

function normalizeAuthorizedUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value.filter(
        (userId): userId is string =>
          typeof userId === "string" && /^\d{17,20}$/.test(userId),
      ),
    ),
  ].slice(0, 50);
}

function toConfig(row: InscriptionConfig | undefined): InscriptionConfigData {
  if (!row) {
    return { ...defaultConfig, questions: [...DEFAULT_RECRUITMENT_QUESTIONS] };
  }

  const questions = normalizeQuestions(row.questions);
  return {
    messageContent:
      row.messageContent === LEGACY_DEFAULT_MESSAGE
        ? DEFAULT_MESSAGE
        : row.messageContent,
    embedTitle:
      row.embedTitle === LEGACY_DEFAULT_EMBED_TITLE
        ? DEFAULT_EMBED_TITLE
        : row.embedTitle,
    buttonLabel:
      row.buttonLabel === LEGACY_DEFAULT_BUTTON_LABEL
        ? DEFAULT_BUTTON_LABEL
        : row.buttonLabel,
    authorizedUserIds: normalizeAuthorizedUserIds(row.authorizedUserIds),
    questions:
      questions.length > 0
        ? questions
        : [...DEFAULT_RECRUITMENT_QUESTIONS],
    customQuestions: normalizeCustomQuestions(row.customQuestions),
    responseChannelId: row.responseChannelId,
    registrationChannelId: row.registrationChannelId,
    registrationMessageId: row.registrationMessageId,
  };
}

export async function getInscriptionConfig(
  guildId: string,
): Promise<InscriptionConfigData> {
  const [row] = await db
    .select()
    .from(inscriptionConfigsTable)
    .where(eq(inscriptionConfigsTable.guildId, guildId))
    .limit(1);

  return toConfig(row);
}

export async function saveInscriptionConfig(
  guildId: string,
  changes: Partial<InscriptionConfigData>,
): Promise<InscriptionConfigData> {
  const current = await getInscriptionConfig(guildId);
  const next: InscriptionConfigData = {
    ...current,
    ...changes,
    authorizedUserIds:
      changes.authorizedUserIds ?? current.authorizedUserIds,
    questions: changes.questions ?? current.questions,
    customQuestions: changes.customQuestions ?? current.customQuestions,
  };

  const [existing] = await db
    .select({ id: inscriptionConfigsTable.id })
    .from(inscriptionConfigsTable)
    .where(eq(inscriptionConfigsTable.guildId, guildId))
    .limit(1);

  if (existing) {
    await db
      .update(inscriptionConfigsTable)
      .set({
        messageContent: next.messageContent,
        embedTitle: next.embedTitle,
        buttonLabel: next.buttonLabel,
        authorizedUserIds: next.authorizedUserIds,
        questions: next.questions,
        customQuestions: next.customQuestions,
        responseChannelId: next.responseChannelId,
        registrationChannelId: next.registrationChannelId,
        registrationMessageId: next.registrationMessageId,
        updatedAt: new Date(),
      })
      .where(eq(inscriptionConfigsTable.id, existing.id));
  } else {
    await db.insert(inscriptionConfigsTable).values({
      guildId,
      messageContent: next.messageContent,
      embedTitle: next.embedTitle,
      buttonLabel: next.buttonLabel,
      authorizedUserIds: next.authorizedUserIds,
      questions: next.questions,
      customQuestions: next.customQuestions,
      responseChannelId: next.responseChannelId,
      registrationChannelId: next.registrationChannelId,
      registrationMessageId: next.registrationMessageId,
    });
  }

  return next;
}