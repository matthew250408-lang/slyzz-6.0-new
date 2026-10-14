import {
  ChannelType,
  Client,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Guild,
  type Message,
  type TextChannel,
} from "discord.js";
import type { MaintenanceService } from "@workspace/db";
import {
  STAFF_ABSENCE_CHANNEL_ID,
  SUPPORT_MAINTENANCE_CHANNEL_ID,
} from "./constants";
import { logger } from "../lib/logger";
import { errorEmbed } from "./embeds";
import { syncRegistrationMessage } from "./message";
import {
  clearExpiredMaintenance,
  clearMaintenance,
  getActiveMaintenance,
  getActiveMaintenances,
  getMaintenanceMessage,
  maintenanceReasonLabel,
  saveMaintenanceMessage,
  setMaintenance,
  type MaintenanceRecord,
} from "./maintenance-store";
import { getInscriptionConfig } from "./store";

const BRUSSELS_TIME_ZONE = "Europe/Brussels";
const MAINTENANCE_NOTICE_DELETE_DELAY_MS = 60_000;
let expirySweepRunning = false;
let expiryWatcherStarted = false;
const maintenanceNoticeDeletionTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

function maintenanceNoticeTimerKey(
  guildId: string,
  service: "support" | "staff-absence",
): string {
  return `${guildId}:${service}`;
}

function cancelMaintenanceNoticeDeletion(
  guildId: string,
  service: "support" | "staff-absence",
): void {
  const key = maintenanceNoticeTimerKey(guildId, service);
  const timer = maintenanceNoticeDeletionTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    maintenanceNoticeDeletionTimers.delete(key);
  }
}

function scheduleMaintenanceNoticeDeletion(
  guild: Guild,
  service: "support" | "staff-absence",
  message: Message,
  finishedAt: Date,
): void {
  cancelMaintenanceNoticeDeletion(guild.id, service);

  const key = maintenanceNoticeTimerKey(guild.id, service);
  const deletionAt =
    finishedAt.getTime() + MAINTENANCE_NOTICE_DELETE_DELAY_MS;
  const timeout = setTimeout(() => {
    void (async () => {
      if (maintenanceNoticeDeletionTimers.get(key) !== timeout) {
        return;
      }

      try {
        const [activeMaintenance, tracked] = await Promise.all([
          getActiveMaintenance(service),
          fetchTrackedMessage(guild, service),
        ]);
        const currentEmbed = tracked?.message.embeds[0];
        const currentTimestamp = currentEmbed?.timestamp
          ? Date.parse(currentEmbed.timestamp)
          : Number.NaN;

        if (
          activeMaintenance ||
          !tracked ||
          tracked.message.id !== message.id ||
          currentEmbed?.title !== `${maintenanceNoticeTitle(service)} terminée` ||
          !Number.isFinite(currentTimestamp) ||
          Math.floor(currentTimestamp / 1000) !==
            Math.floor(finishedAt.getTime() / 1000)
        ) {
          return;
        }

        await tracked.message.delete();
        logger.info(
          { guildId: guild.id, service, messageId: tracked.message.id },
          "Deleted completed maintenance notice",
        );
      } catch (error) {
        logger.warn(
          { err: error, guildId: guild.id, service },
          "Could not delete completed maintenance notice",
        );
      } finally {
        if (maintenanceNoticeDeletionTimers.get(key) === timeout) {
          maintenanceNoticeDeletionTimers.delete(key);
        }
      }
    })();
  }, Math.max(0, deletionAt - Date.now()));

  maintenanceNoticeDeletionTimers.set(key, timeout);
}

function localDateTimeParts(date: Date): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BRUSSELS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function parseBrusselsDateTime(value: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(
    value.trim(),
  );
  if (!match) {
    return null;
  }

  const [, dayValue, monthValue, yearValue, hourValue, minuteValue] = match;
  const day = Number(dayValue);
  const month = Number(monthValue);
  const year = Number(yearValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute);
  const target = new Date(targetUtc);

  if (
    target.getUTCFullYear() !== year ||
    target.getUTCMonth() !== month - 1 ||
    target.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }

  for (const offsetMinutes of [120, 60]) {
    const candidate = new Date(targetUtc - offsetMinutes * 60_000);
    const parts = localDateTimeParts(candidate);
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute
    ) {
      return candidate;
    }
  }

  // This also rejects local times that do not exist during the spring DST change.
  return null;
}

function discordTime(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:F> (<t:${Math.floor(date.getTime() / 1000)}:R>)`;
}

function maintenanceEndText(date: Date | null): string {
  return date
    ? `**Fin prévue :** ${discordTime(date)}`
    : "**Fin :** manuelle — à terminer avec `/maintenance`.";
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}

function statusEmbed(records: MaintenanceRecord[]): EmbedBuilder {
  const byService = new Map(records.map((record) => [record.service, record]));
  const services = [
    { key: "support", label: "Support" },
    { key: "recrutement", label: "Recrutement" },
    { key: "staff-absence", label: "Absences staff" },
  ] as const;
  const activeServices = services.filter(({ key }) => byService.has(key));
  const website = byService.get("site-web");
  const notice = byService.get("notice");
  const serviceLines = services.map(({ key, label }) =>
    byService.has(key)
      ? `🔴 **${label}** — maintenance en cours`
      : `🟢 **${label}** — en ligne`,
  );
  const summary =
    activeServices.length > 0
      ? `🔴 **${activeServices.length} service${activeServices.length > 1 ? "s" : ""} en maintenance** : ${activeServices.map(({ label }) => label).join(", ")}.`
      : "🟢 **Tous les services du bot sont opérationnels.**";
  const detailFields = activeServices.map(({ key, label }) => {
    const record = byService.get(key);
    if (!record) {
      return { name: `Maintenance — ${label}`, value: "État indisponible.", inline: false };
    }

    return {
      name: `🛠️ Maintenance — ${label}`,
      value: [
        `**Raison :** ${maintenanceReasonLabel(record.reason)}`,
        record.message
          ? `**Précision :** ${truncate(record.message, 300)}`
          : undefined,
        maintenanceEndText(record.endsAt),
      ]
        .filter(Boolean)
        .join("\n"),
      inline: false,
    };
  });
  const websiteField = {
    name: "🌐 Site web Slyzz",
    value: website
      ? [
          "🟠 **Maintenance déclarée — état non vérifié**",
          "Biscotto ne contrôle pas et ne coupe pas le site web.",
          `**Raison :** ${maintenanceReasonLabel(website.reason)}`,
          website.message
            ? `**Précision :** ${truncate(website.message, 250)}`
            : undefined,
          maintenanceEndText(website.endsAt),
        ]
          .filter(Boolean)
          .join("\n")
      : "⚪ **Non surveillé par Biscotto** — aucun site web n’est connecté au bot.",
    inline: false,
  };
  const noticeField = {
    name: "📢 Avis de mise à jour",
    value: notice
      ? [
          "🟠 **Avis actif — les services ne sont pas coupés**",
          `**Raison :** ${maintenanceReasonLabel(notice.reason)}`,
          notice.message
            ? `**Message :** ${truncate(notice.message, 300)}`
            : undefined,
          maintenanceEndText(notice.endsAt),
        ]
          .filter(Boolean)
          .join("\n")
      : "Aucun avis actif.",
    inline: false,
  };

  return new EmbedBuilder()
    .setColor(
      activeServices.length > 0 ? 0xe45b5b : website || notice ? 0xe9ad54 : 0x55b77a,
    )
    .setTitle("📊 Statut des services")
    .setDescription(
      `${summary}\nLes maintenances avec une fin programmée se terminent automatiquement.`,
    )
    .addFields(
      { name: "État actuel", value: serviceLines.join("\n"), inline: false },
      ...detailFields,
      websiteField,
      noticeField,
    )
    .setFooter({
      text: "Sans date de fin, la maintenance doit être terminée manuellement avec /maintenance.",
    })
    .setTimestamp();
}

function maintenanceNoticeTitle(
  service: "support" | "staff-absence",
): string {
  return service === "support"
    ? "Maintenance du support"
    : "Maintenance des absences staff";
}

function maintenanceNoticeChannelId(
  service: "support" | "staff-absence",
): string {
  return service === "support"
    ? SUPPORT_MAINTENANCE_CHANNEL_ID
    : STAFF_ABSENCE_CHANNEL_ID;
}

function maintenanceNoticeEmbed(
  service: "support" | "staff-absence",
  record: MaintenanceRecord,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xe45b5b)
    .setTitle(`${maintenanceNoticeTitle(service)} en cours`)
    .setDescription(
      service === "support"
        ? "⏸️ Le support est temporairement indisponible."
        : "⏸️ Les annonces d’absence staff sont temporairement suspendues.",
    )
    .addFields(
      {
        name: "Raison",
        value: maintenanceReasonLabel(record.reason),
        inline: true,
      },
      {
        name: "Durée",
        value: record.endsAt
          ? `Jusqu’au ${discordTime(record.endsAt)}`
          : "Jusqu’à la réactivation manuelle.",
        inline: true,
      },
      {
        name: "Précision",
        value: truncate(record.message || "Aucune précision complémentaire.", 900),
        inline: false,
      },
    )
    .setTimestamp();
}

async function fetchGuildTextChannel(
  guild: Guild,
  channelId: string,
): Promise<TextChannel | null> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel?.type === ChannelType.GuildText ? channel : null;
}

async function fetchTrackedMessage(
  guild: Guild,
  kind: "status" | "support" | "staff-absence",
): Promise<{ channel: TextChannel; message: Message } | null> {
  const reference = await getMaintenanceMessage(guild.id, kind);
  if (!reference) {
    return null;
  }
  const channel = await fetchGuildTextChannel(guild, reference.channelId);
  if (!channel) {
    return null;
  }
  const message = await channel.messages.fetch(reference.messageId).catch(() => null);
  return message ? { channel, message } : null;
}

async function upsertTrackedMessage(
  guild: Guild,
  kind: "status" | "support" | "staff-absence",
  embed: EmbedBuilder,
  fallbackChannelId?: string,
): Promise<Message | null> {
  const reference = await getMaintenanceMessage(guild.id, kind);
  const preferredChannelId = reference?.channelId ?? fallbackChannelId;
  if (!preferredChannelId) {
    return null;
  }

  let channel = await fetchGuildTextChannel(guild, preferredChannelId);
  if (!channel && fallbackChannelId && fallbackChannelId !== preferredChannelId) {
    channel = await fetchGuildTextChannel(guild, fallbackChannelId);
  }
  if (!channel) {
    return null;
  }

  if (reference && channel.id === reference.channelId) {
    const existingMessage = await channel.messages
      .fetch(reference.messageId)
      .catch(() => null);
    if (existingMessage) {
      return existingMessage.edit({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
    }
  }

  const message = await channel.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
  await saveMaintenanceMessage({
    guildId: guild.id,
    kind,
    channelId: channel.id,
    messageId: message.id,
  });
  return message;
}

async function finishMaintenanceNotice(
  guild: Guild,
  service: "support" | "staff-absence",
  endedAt?: Date,
): Promise<void> {
  const tracked = await fetchTrackedMessage(guild, service);
  const existingEmbed = tracked?.message.embeds[0];
  if (!tracked || !existingEmbed) {
    return;
  }

  const finishedTitle = `${maintenanceNoticeTitle(service)} terminée`;
  const wasAlreadyFinished = existingEmbed.title === finishedTitle;
  const existingFinishedAt = existingEmbed.timestamp
    ? new Date(existingEmbed.timestamp)
    : null;
  const hasValidFinishedAt =
    existingFinishedAt !== null &&
    Number.isFinite(existingFinishedAt.getTime());
  const finishedAt =
    endedAt ??
    (wasAlreadyFinished && hasValidFinishedAt
      ? existingFinishedAt
      : new Date());
  const timestampMatches =
    wasAlreadyFinished &&
    hasValidFinishedAt &&
    Math.floor(existingFinishedAt.getTime() / 1000) ===
      Math.floor(finishedAt.getTime() / 1000);

  if (!timestampMatches) {
    const finishedEmbed = EmbedBuilder.from(existingEmbed)
      .setColor(0x55b77a)
      .setTitle(finishedTitle)
      .setDescription(
        service === "support"
          ? "✅ Le support est de nouveau disponible."
          : "✅ Les annonces d’absence staff sont de nouveau disponibles.",
      )
      .setTimestamp(finishedAt);
    await tracked.message.edit({
      embeds: [finishedEmbed],
      allowedMentions: { parse: [] },
    });
  }

  scheduleMaintenanceNoticeDeletion(guild, service, tracked.message, finishedAt);
}

export async function refreshMaintenanceMessages(
  client: Client,
  completedAtByService: Map<MaintenanceService, Date> = new Map(),
): Promise<void> {
  const records = await getActiveMaintenances();
  const activeByService = new Map(records.map((record) => [record.service, record]));

  for (const guild of client.guilds.cache.values()) {
    const statusReference = await getMaintenanceMessage(guild.id, "status");
    if (statusReference) {
      try {
        await upsertTrackedMessage(guild, "status", statusEmbed(records));
      } catch (error) {
        logger.warn(
          { err: error, guildId: guild.id },
          "Could not refresh the maintenance status embed",
        );
      }
    }

    for (const service of ["support", "staff-absence"] as const) {
      try {
        const record = activeByService.get(service);
        if (record) {
          cancelMaintenanceNoticeDeletion(guild.id, service);
          await upsertTrackedMessage(
            guild,
            service,
            maintenanceNoticeEmbed(service, record),
            maintenanceNoticeChannelId(service),
          );
        } else {
          await finishMaintenanceNotice(
            guild,
            service,
            completedAtByService.get(service),
          );
        }
      } catch (error) {
        logger.warn(
          { err: error, guildId: guild.id, service },
          "Could not refresh a maintenance notice",
        );
      }
    }
  }
}

async function refreshRecruitmentMessages(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      const config = await getInscriptionConfig(guild.id);
      if (!config.registrationChannelId || !config.registrationMessageId) {
        continue;
      }
      const channel = await guild.channels
        .fetch(config.registrationChannelId)
        .catch(() => null);
      if (channel?.type === ChannelType.GuildText) {
        await syncRegistrationMessage(guild, channel as TextChannel);
      }
    } catch (error) {
      logger.warn(
        { err: error, guildId: guild.id },
        "Could not refresh recruitment message after maintenance change",
      );
    }
  }
}

function maintenanceTargets(service: string): MaintenanceService[] {
  if (service === "tout") {
    return ["support", "recrutement", "staff-absence", "site-web"];
  }
  if (service === "annonce") {
    return ["notice"];
  }
  if (
    service === "support" ||
    service === "recrutement" ||
    service === "staff-absence" ||
    service === "site-web"
  ) {
    return [service];
  }
  return [];
}

function maintenanceServiceLabel(service: string): string {
  switch (service) {
    case "support":
      return "support";
    case "recrutement":
      return "recrutement";
    case "staff-absence":
      return "annonces d’absence staff";
    case "site-web":
      return "état du site web Slyzz";
    default:
      return service;
  }
}

export async function handleMaintenanceCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const action = interaction.options.getString("action", true);
  const service = interaction.options.getString("service", true);
  await interaction.deferReply(
    service === "annonce" || service === "site-web"
      ? {}
      : { flags: MessageFlags.Ephemeral },
  );
  const services = maintenanceTargets(service);
  if (services.length === 0) {
    await interaction.editReply({
      embeds: [errorEmbed("Service inconnu", "Choisis un service valide.")],
    });
    return;
  }

  if (action === "stop") {
    const toClear: MaintenanceService[] =
      service === "tout"
        ? ["support", "recrutement", "staff-absence", "site-web", "notice"]
        : services;
    await clearMaintenance(toClear);
    if (toClear.includes("recrutement")) {
      await refreshRecruitmentMessages(interaction.client);
    }
    await refreshMaintenanceMessages(interaction.client);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf2b2a8)
          .setTitle("Maintenance terminée")
          .setDescription(
            service === "tout"
              ? "Le support, le recrutement et les annonces d’absence staff sont de nouveau en ligne. Le suivi du site web Slyzz et les avis d’information ont aussi été effacés."
              : service === "annonce"
                ? "L’avis de mise à jour a été retiré."
                : service === "site-web"
                  ? "Le suivi de maintenance du site web Slyzz a été retiré. Le bot ne contrôle pas sa disponibilité."
                  : `Le service **${maintenanceServiceLabel(service)}** est de nouveau en ligne.`,
          ),
      ],
    });
    return;
  }

  const endText = interaction.options.getString("fin");
  const reasonValue = interaction.options.getString("raison");
  const message = interaction.options.getString("message")?.trim() ?? "";
  const validReasons = [
    "mise-a-jour",
    "incident-technique",
    "maintenance-preventive",
    "autre",
  ] as const;
  if (
    !reasonValue ||
    !validReasons.includes(reasonValue as (typeof validReasons)[number]) ||
    (reasonValue === "autre" && !message)
  ) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Informations manquantes",
          "Pour activer une maintenance, choisis une raison. La date de fin est facultative; si elle est omise, le service restera suspendu jusqu’à sa réactivation manuelle. Ajoute une précision si la raison est « Autre ».",
        ),
      ],
    });
    return;
  }

  const endsAt = endText ? parseBrusselsDateTime(endText) : null;
  if (endText && (!endsAt || endsAt.getTime() <= Date.now())) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Date de fin invalide",
          "La date de fin doit être future et réelle au format **JJ/MM/AAAA HH:mm**, heure de Bruxelles.",
        ),
      ],
    });
    return;
  }

  if (service === "tout") {
    await clearMaintenance(["notice"]);
  }
  for (const target of services) {
    await setMaintenance(target, {
      message,
      reason: reasonValue as (typeof validReasons)[number],
      endsAt,
      updatedByUserId: interaction.user.id,
    });
  }

  if (services.includes("recrutement")) {
    await refreshRecruitmentMessages(interaction.client);
  }
  await refreshMaintenanceMessages(interaction.client);

  const serviceLabel =
    service === "tout"
      ? "Le support, le recrutement, les annonces d’absence staff et l’état du site web Slyzz (suivi uniquement)"
      : service === "annonce"
        ? "L’avis de mise à jour"
        : `Le service **${maintenanceServiceLabel(service)}**`;
  const websiteNote =
    service === "site-web" || service === "tout"
      ? "\n\nLe suivi du site Slyzz est informatif : le bot ne le met pas hors ligne."
      : "";
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xf2b2a8)
        .setTitle(
          service === "annonce"
            ? "Avis programmé"
            : service === "site-web"
              ? "État du site Slyzz mis à jour"
              : "Maintenance activée",
        )
        .setDescription(
          `${serviceLabel} ${service === "annonce" ? "sera affiché" : service === "site-web" ? "est marqué en maintenance" : "est en maintenance"}${endsAt ? ` jusqu’au ${discordTime(endsAt)}` : " sans date de fin; il faudra la terminer manuellement"}.\n\n**Raison :** ${maintenanceReasonLabel(reasonValue as (typeof validReasons)[number])}${message ? `\n${message}` : ""}${websiteNote}`,
        ),
    ],
  });
}

export async function handleStatusCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild;
  const channel = interaction.channel;
  if (!guild || channel?.type !== ChannelType.GuildText) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Salon indisponible",
          "Utilise cette commande dans un salon textuel du serveur.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const records = await getActiveMaintenances();
    const statusMessage = await upsertTrackedMessage(
      guild,
      "status",
      statusEmbed(records),
      channel.id,
    );
    if (!statusMessage) {
      throw new Error("No writable text channel was available for the status embed.");
    }
    await interaction.deleteReply();
  } catch (error) {
    logger.warn(
      { err: error, guildId: guild.id, channelId: channel.id },
      "Could not publish the maintenance status embed",
    );
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Publication impossible",
          "Je n’ai pas pu publier ou mettre à jour l’embed de statut dans ce salon.",
        ),
      ],
    });
  }
}

export function startMaintenanceExpiryWatcher(client: Client): void {
  if (expiryWatcherStarted) {
    return;
  }
  expiryWatcherStarted = true;

  const sweep = async (synchronizeOnStart = false) => {
    if (expirySweepRunning) {
      return;
    }
    expirySweepRunning = true;
    try {
      const expired = await clearExpiredMaintenance();
      const expiredServices = expired.map((record) => record.service);
      if (expiredServices.includes("recrutement")) {
        await refreshRecruitmentMessages(client);
      }
      if (expired.length > 0 || synchronizeOnStart) {
        if (expired.length > 0) {
          logger.info(
            { services: expiredServices },
            "Maintenance period expired",
          );
        }
        await refreshMaintenanceMessages(
          client,
          new Map(expired.map((record) => [record.service, record.endsAt])),
        );
      }
    } catch (error) {
      logger.error({ err: error }, "Could not clear expired maintenance");
    } finally {
      expirySweepRunning = false;
    }
  };

  void sweep(true);
  setInterval(() => void sweep(), 5_000);
}
