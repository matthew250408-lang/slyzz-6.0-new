import {
  ChannelType,
  Client,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import type { MaintenanceService } from "@workspace/db";
import { logger } from "../lib/logger";
import { errorEmbed } from "./embeds";
import { syncRegistrationMessage } from "./message";
import {
  clearExpiredMaintenance,
  clearMaintenance,
  getActiveMaintenances,
  maintenanceReasonLabel,
  setMaintenance,
  type MaintenanceRecord,
} from "./maintenance-store";
import { getInscriptionConfig } from "./store";

const BRUSSELS_TIME_ZONE = "Europe/Brussels";
let expirySweepRunning = false;
let expiryWatcherStarted = false;

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
  await interaction.deferReply();
  const records = await getActiveMaintenances();
  await interaction.editReply({
    embeds: [statusEmbed(records)],
    allowedMentions: { parse: [] },
  });
}

export function startMaintenanceExpiryWatcher(client: Client): void {
  if (expiryWatcherStarted) {
    return;
  }
  expiryWatcherStarted = true;

  const sweep = async () => {
    if (expirySweepRunning) {
      return;
    }
    expirySweepRunning = true;
    try {
      const expired = await clearExpiredMaintenance();
      if (expired.includes("recrutement")) {
        await refreshRecruitmentMessages(client);
      }
      if (expired.length > 0) {
        logger.info({ services: expired }, "Maintenance period expired");
      }
    } catch (error) {
      logger.error({ err: error }, "Could not clear expired maintenance");
    } finally {
      expirySweepRunning = false;
    }
  };

  void sweep();
  setInterval(() => void sweep(), 5_000);
}
