import {
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type Role,
  type User,
} from "discord.js";
import {
  AUTHORIZED_SETUP_USER_IDS,
  BOT_DEVELOPER_ID,
  BOT_LAST_MODIFIED,
  BOT_VERSION,
  DATE_EMOJI,
  DERANK_EMOJI,
  DEFAULT_EMBED_TITLE,
  HIGHEST_ROLE_EMOJI,
  MEMBER_EMOJI,
  RANK_EMOJI,
  REASON_EMOJI,
  STAFF_ABSENCE_STATUS_PREFIX,
  questionLabel,
} from "./constants";
import type { InscriptionConfigData } from "./store";

const EMBED_COLOR = 0xf2b2a8;

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

export function infoEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(title)
    .setDescription(description);
}

export function botInfoEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("Informations sur Biscotto")
    .addFields(
      { name: "Version", value: BOT_VERSION, inline: true },
      { name: "Développeur", value: `<@${BOT_DEVELOPER_ID}>`, inline: true },
      { name: "Dernière modification", value: BOT_LAST_MODIFIED, inline: false },
    );
}

export function serverInfoEmbed(guild: Guild, owner: User): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Informations sur ${guild.name}`)
    .addFields(
      { name: "Propriétaire", value: `<@${owner.id}>`, inline: true },
      { name: "Membres", value: guild.memberCount.toLocaleString("fr-FR"), inline: true },
      {
        name: "Créé le",
        value: guild.createdAt.toLocaleDateString("fr-FR"),
        inline: true,
      },
      {
        name: "Salons",
        value: guild.channels.cache.size.toLocaleString("fr-FR"),
        inline: true,
      },
      {
        name: "Rôles",
        value: Math.max(0, guild.roles.cache.size - 1).toLocaleString("fr-FR"),
        inline: true,
      },
      {
        name: "Niveau de boost",
        value: guild.premiumTier.toString(),
        inline: true,
      },
      { name: "Identifiant", value: `\`${guild.id}\``, inline: false },
    )
    .setTimestamp();

  const iconURL = guild.iconURL({ size: 512 });
  if (iconURL) {
    embed.setThumbnail(iconURL);
  }

  return embed;
}

export function staffAbsenceEmbed(
  member: GuildMember,
  startDate: string,
  endDate: string,
  reason: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("Absence du staff")
    .setDescription(
      [
        `${MEMBER_EMOJI} **Membre :** <@${member.id}>`,
        `${HIGHEST_ROLE_EMOJI} **Rôle le plus élevé :** <@&${member.roles.highest.id}>`,
        `${DATE_EMOJI} **Date :** du ${startDate} au ${endDate}`,
        `${REASON_EMOJI} **Raison :** ${reason.trim()}`,
        `${STAFF_ABSENCE_STATUS_PREFIX}⏳ En cours...`,
      ].join("\n"),
    )
    .setThumbnail(member.displayAvatarURL())
    .setTimestamp();
}

export function rankActionEmbed(
  action: "rank" | "derank",
  member: User,
  role: Role,
  actor: User,
  reason: string,
  associatedRole: Role,
): EmbedBuilder {
  const isRank = action === "rank";
  const heading = isRank
    ? `${RANK_EMOJI} Rank-Up !`
    : `${DERANK_EMOJI} Derank !`;
  const actionLines = isRank
    ? [
        `**Félicitations**, tu disposes désormais du **grade** <@&${role.id}> !`,
        "Continue ainsi, nous te faisons **confiance** !",
      ]
    : [
        `**Dommage !** Tu ne disposes plus du **grade** <@&${role.id}>.`,
        "Nous te souhaitons une **bonne continuation**.",
      ];
  const formattedReason = reason.trim().replace(/\r?\n/g, "\n> ");

  return new EmbedBuilder()
    .setColor(isRank ? 0xf2b2a8 : 0xf2b2a8)
    .setDescription(
      [
        `## ${heading}`,
        ...actionLines,
        ...(associatedRole.id === role.id
          ? []
          : [
              `Le rôle complémentaire <@&${associatedRole.id}> a également été ${isRank ? "attribué" : "retiré"}.`,
            ]),
        "",
        `> ${MEMBER_EMOJI} **Membre :** <@${member.id}>`,
        `> ${REASON_EMOJI} **Raison :** ${formattedReason}`,
      ].join("\n"),
    )
    .setFooter({
      text: `Action effectuée par ${actor.username}`,
      iconURL: actor.displayAvatarURL(),
    })
    .setTimestamp();
}

export function commandsHelpEmbed(userMention: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("Mention Biscotto !")
    .setDescription(
      `Salut ${userMention} ! Je suis **Biscotto**, mon **propriétaire** est **Slyzz**. Mon rôle est d’aider **Slyzz** à gérer les serveurs où il est **Administrateurs**.\nSi tu as **une question** par rapport à moi, ou même **Slyzz**, hésite pas à m’envoyer un **message privé** !`,
    );
}

export function successEmbed(
  title: string,
  description: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(title)
    .setDescription(description);
}

export function errorEmbed(
  title: string,
  description: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(title)
    .setDescription(description);
}

export function setupEmbed(
  config: InscriptionConfigData,
): EmbedBuilder {
  const ready = config.questions.length > 0 && config.responseChannelId;
  const questionList = config.questions
    .map((question, index) => `\`${String(index + 1).padStart(2, "0")}\` ${questionLabel(question)}`)
    .join("\n");

  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: "Slyzz • ESPACE RECRUTEMENT" })
    .setTitle("Configuration des candidatures")
    .setDescription(
      "Prépare un parcours clair et accueillant pour les futurs membres du staff. Les modifications sont enregistrées automatiquement.",
    )
    .addFields(
      {
        name: "🪧 Titre",
        value: truncate(config.embedTitle || "Non défini", 256),
        inline: true,
      },
      {
        name: "🔘 Bouton",
        value: truncate(config.buttonLabel || "Non défini", 80),
        inline: true,
      },
      {
        name: "📬 Réponses reçues dans",
        value: config.responseChannelId
          ? `<#${config.responseChannelId}>`
          : "À configurer",
        inline: true,
      },
      {
        name: `🧩 Questions sélectionnées · ${config.questions.length}/5`,
        value: questionList || "Choisis les questions que tu veux poser.",
        inline: false,
      },
      {
        name: "✍️ Message affiché aux candidats",
        value: truncate(config.messageContent || "Aucun message défini.", 900),
        inline: false,
      },
      {
        name: "État du formulaire",
        value: ready
          ? "✅ Prêt à recevoir des candidatures"
          : "🟠 Choisis au moins une question et un salon de réception",
        inline: false,
      },
    )
    .setFooter({
      text: "Les changements sont enregistrés automatiquement • Aperçu disponible ci-dessous",
    });
}

export function permissionsEmbed(
  config: InscriptionConfigData,
): EmbedBuilder {
  const primaryAdministrators = [...AUTHORIZED_SETUP_USER_IDS]
    .map((userId) => `<@${userId}>`)
    .join("\n");
  const authorizedMembers =
    config.authorizedUserIds.length > 0
      ? truncate(
          config.authorizedUserIds
            .map((userId, index) => `\`${String(index + 1).padStart(2, "0")}\` <@${userId}>`)
            .join("\n"),
          1024,
        )
      : "Personne pour le moment — les deux administrateurs principaux conservent toujours l’accès.";

  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: "Slyzz • CONTRÔLE DES ACCÈS" })
    .setTitle("Qui peut gérer le recrutement ?")
    .setDescription(
      "Accorde l’accès de configuration aux personnes de confiance. Seuls les administrateurs principaux peuvent modifier cette liste.",
    )
    .addFields(
      {
        name: "🔐 Administrateurs principaux",
        value: primaryAdministrators,
        inline: false,
      },
      {
        name: `🛠️ Membres autorisés · ${config.authorizedUserIds.length}`,
        value: authorizedMembers,
        inline: false,
      },
      {
        name: "ℹ️ Portée de l’accès",
        value:
          "Les personnes autorisées peuvent modifier le message, le bouton, les questions et le salon des candidatures. Elles ne peuvent pas modifier cette liste.",
        inline: false,
      },
    )
    .setFooter({
      text: "Utilise les sélecteurs ci-dessous pour ajouter ou retirer des membres.",
    });
}

export function registrationEmbed(
  title: string,
  messageContent: string,
  buttonLabel: string,
  questions: string[],
  guild?: Guild,
  isReady = false,
  maintenance?: { message: string; reason: string; endsAt: Date | null },
): EmbedBuilder {
  const maintenanceEnd = maintenance?.endsAt
    ? `Retour prévu : <t:${Math.floor(maintenance.endsAt.getTime() / 1000)}:F> (<t:${Math.floor(maintenance.endsAt.getTime() / 1000)}:R>).`
    : "Retour après réactivation manuelle.";
  const maintenanceStatus = maintenance
    ? `🛠️ **Recrutement temporairement suspendu**\n**Raison :** ${maintenance.reason}\n${truncate(maintenance.message || "Aucune précision complémentaire.", 600)}\n\n${maintenanceEnd}`
    : isReady
      ? "🟢 Les candidatures sont ouvertes."
      : "🟠 Ouverture prochaine — l’équipe termine la configuration.";
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(title.trim() || DEFAULT_EMBED_TITLE)
    .setDescription(messageContent)
    .addFields(
      {
        name: "📋 Comment candidater",
        value: `**01**  Clique sur **${buttonLabel}** ci-dessous.\n**02**  Réponds aux questions avec sincérité.\n**03**  Envoie ta candidature à l’équipe.`,
        inline: false,
      },
      {
        name: "🧩 Le formulaire",
        value:
          questions.length > 0
            ? questions.map((question) => `• ${questionLabel(question)}`).join("\n")
            : "Le formulaire de candidature est en préparation.",
        inline: false,
      },
      {
        name: "📣 État",
        value: maintenanceStatus,
        inline: false,
      },
    )
    .setFooter({
      text: "RECRUTEMENT • Merci de prendre le temps de répondre avec soin",
    });

  if (guild) {
    const iconURL = guild.iconURL({ size: 256 });
    embed.setAuthor({
      name: `${guild.name} • ${maintenance ? "RECRUTEMENT EN PAUSE" : isReady ? "CANDIDATURES OUVERTES" : "RECRUTEMENT EN PRÉPARATION"}`,
    });
    const bannerURL = guild.bannerURL({ size: 1024 });
    if (bannerURL) {
      embed.setImage(bannerURL);
    } else if (iconURL) {
      embed.setThumbnail(iconURL);
    }
  }

  return embed;
}

export function applicationEmbed(
  user: User,
  answers: Array<{ questionId: string; answer: string }>,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({
      name: "NOUVELLE CANDIDATURE • RECRUTEMENT",
    })
    .setTitle(user.globalName ?? user.username)
    .setDescription(
      `Candidature reçue de <@${user.id}>.\n${answers.length} réponses transmises à l’équipe.`,
    )
    .addFields(
      {
        name: "Candidat",
        value: `<@${user.id}>\n\`${user.id}\``,
        inline: true,
      },
      {
        name: "Réponses",
        value: `${answers.length} / 5`,
        inline: true,
      },
      ...answers.map(({ questionId, answer }, index) => ({
        name: `${String(index + 1).padStart(2, "0")} · ${questionLabel(questionId)}`,
        value: truncate(answer || "Aucune réponse", 1024),
        inline: false,
      })),
    )
    .setThumbnail(user.displayAvatarURL({ size: 512 }))
    .setFooter({ text: "CANDIDATURE • À étudier par l’équipe" })
    .setTimestamp();
}