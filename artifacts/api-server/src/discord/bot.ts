import {
  ActivityType,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionFlagsBits,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
  type UserSelectMenuInteraction,
} from "discord.js";
import { logger } from "../lib/logger";
import {
  AVAILABLE_QUESTIONS,
  DEFAULT_BUTTON_LABEL,
  DEFAULT_MESSAGE,
  AUTHORIZED_SETUP_USER_IDS,
  OKAY_EMOJI_NAME,
  RANK_COMMAND_ACCESS_ROLE_ID,
  RANK_ANNOUNCEMENT_CHANNEL_ID,
  RANK_ANNOUNCEMENT_ROLE_ID,
  STAFF_ABSENCE_ACCESS_ROLE_ID,
  STAFF_ABSENCE_CHANNEL_ID,
  STAFF_ABSENCE_STATUS_PREFIX,
  customQuestionKey,
  isCustomQuestionKey,
  questionLabel,
} from "./constants";
import {
  applicationEmbed,
  botInfoEmbed,
  errorEmbed,
  commandsHelpEmbed,
  permissionsEmbed,
  rankActionEmbed,
  registrationEmbed,
  serverInfoEmbed,
  setupEmbed,
  successEmbed,
  staffAbsenceEmbed,
} from "./embeds";
import {
  REGISTRATION_BUTTON_ID,
  registrationComponents,
  syncRegistrationMessage,
} from "./message";
import {
  getInscriptionConfig,
  saveInscriptionConfig,
  type InscriptionConfigData,
} from "./store";
import {
  getActiveMaintenance,
  maintenanceReasonLabel,
} from "./maintenance-store";
import {
  handleMaintenanceCommand,
  handleStatusCommand,
  startMaintenanceExpiryWatcher,
} from "./maintenance";
import {
  handleModmailButton,
  handleModmailModal,
  handleModmailMessage,
  isModmailButton,
  isModmailModal,
} from "./modmail";
import { createCustomEmbed } from "./custom-embed";

const SETUP_PREFIX = "setup:inscription:";
const QUESTION_SELECT_ID = `${SETUP_PREFIX}questions`;
const RESPONSE_CHANNEL_SELECT_ID = `${SETUP_PREFIX}response-channel`;
const MESSAGE_SETUP_BUTTON_ID = `${SETUP_PREFIX}message`;
const BUTTON_SETUP_BUTTON_ID = `${SETUP_PREFIX}button`;
const TITLE_SETUP_BUTTON_ID = `${SETUP_PREFIX}title`;
const PERMISSIONS_SETUP_BUTTON_ID = `${SETUP_PREFIX}permissions`;
const PREVIEW_SETUP_BUTTON_ID = `${SETUP_PREFIX}preview`;
const ADD_PERMISSION_USER_SELECT_ID = `${SETUP_PREFIX}permissions:add`;
const REMOVE_PERMISSION_USER_SELECT_ID = `${SETUP_PREFIX}permissions:remove`;
const ADD_QUESTION_SETUP_BUTTON_ID = `${SETUP_PREFIX}add-question`;
const ADD_QUESTION_MODAL_ID = `${SETUP_PREFIX}add-question-modal`;
const PERMISSIONS_MODAL_ID = `${SETUP_PREFIX}permissions-modal`;
const MEMBER_MODAL_ID = "registration:form";
const SEND_FORM_COMMAND_NAME = "envoyer-formulaire";
const SETUP_PERMISSION_COMMAND_NAME = "setup-permission";
const MESSAGE_COMMAND_NAME = "message";
const BOT_INFO_COMMAND_NAME = "info-bot";
const RANK_DERANK_COMMAND_NAME = "rank-derank";
const SERVER_INFO_COMMAND_NAME = "info-serveur";
const STAFF_ABSENCE_COMMAND_NAME = "absence-staff";
const MAINTENANCE_COMMAND_NAME = "maintenance";
const STATUS_COMMAND_NAME = "status";
const MAINTENANCE_ALLOWED_USER_IDS = new Set([
  "1140296215469240401",
  "1487882100613971979",
]);
const MAINTENANCE_ALLOWED_ROLE_IDS = new Set(["1530654006068645938"]);
const STATUS_ALLOWED_USER_ID = "1140296215469240401";
const STATUS_ALLOWED_ROLE_IDS = new Set([
  "1529149444887543909",
  "1530654006068645938",
]);
const STAFF_ABSENCE_FINISH_BUTTON_PREFIX = "staff-absence:finish:";
const processingStaffAbsenceFinishes = new Set<string>();

function addSetupOptions(command: SlashCommandBuilder) {
  return command
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("Texte du message affiché aux membres")
        .setMaxLength(4000)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("bouton")
        .setDescription("Texte du bouton affiché aux membres")
        .setMinLength(1)
        .setMaxLength(80)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("titre")
        .setDescription("Titre de l'embed de recrutement")
        .setMinLength(1)
        .setMaxLength(256)
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName("formulaire")
        .setDescription(
          "Ouvre le menu pour choisir les questions du formulaire",
        )
        .setRequired(false),
    )
    .addChannelOption((option) =>
      option
        .setName("reponse")
        .setDescription("Salon qui reçoit les réponses")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    );
}

const setupCommand = addSetupOptions(
  new SlashCommandBuilder()
    .setName("setup-inscription")
    .setDescription("Configure le système de recrutement personnalisable"),
);

const setupPermissionCommand = new SlashCommandBuilder()
  .setName(SETUP_PERMISSION_COMMAND_NAME)
  .setDescription("Gère les accès à la configuration du recrutement")
  .addStringOption((option) =>
    option
      .setName("membres")
      .setDescription("Remplace la liste complète avec des IDs séparés par des virgules")
      .setMaxLength(1000)
      .setRequired(false),
  );

const sendFormCommand = new SlashCommandBuilder()
  .setName(SEND_FORM_COMMAND_NAME)
  .setDescription("Envoie le formulaire de recrutement dans ce salon");

const messageCommand = new SlashCommandBuilder()
  .setName(MESSAGE_COMMAND_NAME)
  .setDescription("Crée et envoie un embed personnalisé dans ce salon")
  .addStringOption((option) =>
    option
      .setName("titre")
      .setDescription("Titre de l’embed")
      .setMaxLength(256)
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("description")
      .setDescription("Texte principal de l’embed")
      .setMaxLength(4096)
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("couleur")
      .setDescription("Couleur hexadécimale, par exemple #5865F2")
      .setMaxLength(7)
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("image")
      .setDescription("URL publique de l’image principale")
      .setMaxLength(2048)
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("miniature")
      .setDescription("URL publique de la miniature")
      .setMaxLength(2048)
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("footer")
      .setDescription("Texte affiché en bas de l’embed")
      .setMaxLength(2048)
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("icone-footer")
      .setDescription("URL de l’image affichée à côté du texte du footer")
      .setMaxLength(2048)
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("champs")
      .setDescription(
        'Champs JSON : [{"nom":"Info","contenu":"Texte","inline":true}]',
      )
      .setMaxLength(6000)
      .setRequired(false),
  );

const botInfoCommand = new SlashCommandBuilder()
  .setName(BOT_INFO_COMMAND_NAME)
  .setDescription("Affiche la version et les informations de Biscotto");

const serverInfoCommand = new SlashCommandBuilder()
  .setName(SERVER_INFO_COMMAND_NAME)
  .setDescription("Affiche les informations de ce serveur");

const staffAbsenceCommand = new SlashCommandBuilder()
  .setName(STAFF_ABSENCE_COMMAND_NAME)
  .setDescription("Annonce une absence du staff")
  .addStringOption((option) =>
    option
      .setName("date_debut")
      .setDescription("Date de début au format JJ/MM/AAAA")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("date_fin")
      .setDescription("Date de fin au format JJ/MM/AAAA")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("raison")
      .setDescription("Raison de l'absence")
      .setMinLength(1)
      .setMaxLength(1000)
      .setRequired(true),
  );

const rankDerankCommand = new SlashCommandBuilder()
  .setName(RANK_DERANK_COMMAND_NAME)
  .setDescription("Attribue ou retire le rôle de rang d’un membre")
  .addStringOption((option) =>
    option
      .setName("action")
      .setDescription("Choisis l’action à effectuer")
      .addChoices(
        { name: "Rank", value: "rank" },
        { name: "Derank", value: "derank" },
      )
      .setRequired(true),
  )
  .addUserOption((option) =>
    option
      .setName("membre")
      .setDescription("Membre concerné par le changement de rôle")
      .setRequired(true),
  )
  .addRoleOption((option) =>
    option
      .setName("role")
      .setDescription("Rôle à ajouter ou retirer selon l’action choisie")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("raison")
      .setDescription("Raison affichée dans l’annonce")
      .setMinLength(1)
      .setMaxLength(400)
      .setRequired(true),
  );

const maintenanceCommand = new SlashCommandBuilder()
  .setName(MAINTENANCE_COMMAND_NAME)
  .setDescription("Active ou termine une maintenance temporaire")
  .addStringOption((option) =>
    option
      .setName("action")
      .setDescription("Activer une maintenance ou remettre le service en ligne")
      .addChoices(
        { name: "Activer", value: "start" },
        { name: "Terminer maintenant", value: "stop" },
      )
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("service")
      .setDescription("Service concerné")
      .addChoices(
        { name: "Support", value: "support" },
        { name: "Recrutement", value: "recrutement" },
        { name: "Absences staff", value: "staff-absence" },
        { name: "Site web Slyzz (suivi de statut)", value: "site-web" },
        { name: "Tout (support + recrutement + absences + site)", value: "tout" },
        { name: "Avis de mise à jour (sans couper les services)", value: "annonce" },
      )
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("raison")
      .setDescription("Cause de la maintenance")
      .addChoices(
        { name: "Mise à jour", value: "mise-a-jour" },
        { name: "Incident technique", value: "incident-technique" },
        { name: "Maintenance préventive", value: "maintenance-preventive" },
        { name: "Autre", value: "autre" },
      )
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("fin")
      .setDescription("Facultative : fin au format JJ/MM/AAAA HH:mm, heure de Bruxelles")
      .setMaxLength(20)
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("message")
      .setDescription("Précisions supplémentaires (requises si la raison est Autre)")
      .setMaxLength(1000)
      .setRequired(false),
  );

const statusCommand = new SlashCommandBuilder()
  .setName(STATUS_COMMAND_NAME)
  .setDescription("Affiche l’état des services");

function isPrimarySetupUser(userId: string): boolean {
  return AUTHORIZED_SETUP_USER_IDS.has(userId);
}

function interactionHasRole(
  interaction: ChatInputCommandInteraction,
  roleId: string,
): boolean {
  if (!interaction.inGuild()) {
    return false;
  }
  const roles = interaction.member.roles;
  return Array.isArray(roles)
    ? roles.includes(roleId)
    : roles.cache.has(roleId);
}

function maintenanceReopenText(endsAt: Date | null): string {
  return endsAt
    ? `Réouverture prévue : <t:${Math.floor(endsAt.getTime() / 1000)}:F> (<t:${Math.floor(endsAt.getTime() / 1000)}:R>).`
    : "La maintenance restera active jusqu’à sa réactivation manuelle.";
}

function isAuthorizedSetupUser(
  userId: string,
  config: InscriptionConfigData,
): boolean {
  return (
    isPrimarySetupUser(userId) || config.authorizedUserIds.includes(userId)
  );
}

async function isAuthorizedSetupUserForGuild(
  userId: string,
  guildId: string,
): Promise<boolean> {
  if (isPrimarySetupUser(userId)) {
    return true;
  }

  const config = await getInscriptionConfig(guildId);
  return config.authorizedUserIds.includes(userId);
}

function permissionsModal(config: InscriptionConfigData): ModalBuilder {
  const value = config.authorizedUserIds.join(", ");
  return new ModalBuilder()
    .setCustomId(PERMISSIONS_MODAL_ID)
    .setTitle("Remplacer la liste d’accès")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("authorized-user-ids")
          .setLabel("IDs des membres, séparés par des virgules")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setPlaceholder("Laisse vide pour retirer tous les accès délégués")
          .setValue(value.slice(0, 1000)),
      ),
    );
}

function titleModal(title: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${SETUP_PREFIX}title-modal`)
    .setTitle("Titre de l'embed")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("embed-title")
          .setLabel("Titre affiché au-dessus du message")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(256)
          .setValue(title.slice(0, 256)),
      ),
    );
}

function messageModal(content: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${SETUP_PREFIX}message-modal`)
    .setTitle("Message de recrutement")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("message-content")
          .setLabel("Texte affiché aux membres")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000)
          .setValue(content.slice(0, 4000)),
      ),
    );
}

function buttonModal(label: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${SETUP_PREFIX}button-modal`)
    .setTitle("Texte du bouton")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("button-label")
          .setLabel("Texte affiché sur le bouton")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(80)
          .setValue(label.slice(0, 80)),
      ),
    );
}

function addQuestionModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(ADD_QUESTION_MODAL_ID)
    .setTitle("Ajouter une question")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("question-label")
          .setLabel("Questions séparées par des virgules")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(1000)
          .setPlaceholder("Quel est ton âge ?, Quelle est ta disponibilité ?"),
      ),
    );
}

function questionsMenu(
  selectedQuestions: string[],
  customQuestionLabels: string[],
): StringSelectMenuBuilder {
  const customQuestions = [
    ...new Set([
      ...customQuestionLabels.map(customQuestionKey),
      ...selectedQuestions.filter(isCustomQuestionKey),
    ]),
  ];
  const options = [
    ...AVAILABLE_QUESTIONS.map((question) => ({
      label: question.label,
      value: question.id,
      default: selectedQuestions.includes(question.id),
    })),
    ...customQuestions.map((questionKey) => ({
      label: questionLabel(questionKey).slice(0, 100),
      value: questionKey,
      default: true,
    })),
  ];

  return new StringSelectMenuBuilder()
    .setCustomId(QUESTION_SELECT_ID)
    .setPlaceholder("Sélectionne les questions à poser")
    .setMinValues(1)
    .setMaxValues(Math.min(options.length, 5))
    .addOptions(options.slice(0, 25));
}

function responseChannelMenu(): ChannelSelectMenuBuilder {
  return new ChannelSelectMenuBuilder()
    .setCustomId(RESPONSE_CHANNEL_SELECT_ID)
    .setPlaceholder("Sélectionne le salon de réception")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);
}

function setupPanelComponents(
  selectedQuestions: string[],
  customQuestionLabels: string[],
): [
  ActionRowBuilder<ButtonBuilder>,
  ActionRowBuilder<StringSelectMenuBuilder>,
  ActionRowBuilder<ChannelSelectMenuBuilder>,
] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(MESSAGE_SETUP_BUTTON_ID)
        .setLabel("Configurer le message")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BUTTON_SETUP_BUTTON_ID)
        .setLabel("Configurer le bouton")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(TITLE_SETUP_BUTTON_ID)
        .setLabel("Configurer le titre")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(ADD_QUESTION_SETUP_BUTTON_ID)
        .setLabel("Ajouter une question")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(PREVIEW_SETUP_BUTTON_ID)
        .setLabel("Aperçu")
        .setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      questionsMenu(selectedQuestions, customQuestionLabels),
    ),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      responseChannelMenu(),
    ),
  ];
}

function permissionsPanelComponents(
  config: InscriptionConfigData,
): [
  ActionRowBuilder<UserSelectMenuBuilder>,
  ActionRowBuilder<UserSelectMenuBuilder>,
  ActionRowBuilder<ButtonBuilder>,
] {
  return [
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(ADD_PERMISSION_USER_SELECT_ID)
        .setPlaceholder("Ajouter des membres autorisés…")
        .setMinValues(1)
        .setMaxValues(10),
    ),
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(REMOVE_PERMISSION_USER_SELECT_ID)
        .setPlaceholder("Retirer des membres autorisés…")
        .setMinValues(1)
        .setMaxValues(10)
        .setDisabled(config.authorizedUserIds.length === 0),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(PERMISSIONS_SETUP_BUTTON_ID)
        .setLabel("Remplacer la liste par IDs")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function handleSetupCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Commande indisponible",
          "Cette commande doit être utilisée dans un serveur.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const config = await getInscriptionConfig(interaction.guild.id);
  if (!isAuthorizedSetupUser(interaction.user.id, config)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Accès refusé",
          "Tu n'es pas autorisé à utiliser cette commande.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const messageContent = interaction.options.getString("message");
  const buttonLabel = interaction.options.getString("bouton");
  const embedTitle = interaction.options.getString("titre");
  const formulaireRequested =
    interaction.options.getBoolean("formulaire") ?? false;
  const responseChannel = interaction.options.getChannel("reponse");
  const hasDirectOptions =
    messageContent !== null ||
    buttonLabel !== null ||
    embedTitle !== null ||
    formulaireRequested ||
    responseChannel !== null;

  if (hasDirectOptions) {
    const changes: Parameters<typeof saveInscriptionConfig>[1] = {};

    if (messageContent !== null) {
      changes.messageContent = messageContent;
    }
    if (buttonLabel !== null) {
      changes.buttonLabel = buttonLabel;
    }
    if (embedTitle !== null) {
      changes.embedTitle = embedTitle;
    }
    if (responseChannel !== null) {
      changes.responseChannelId = responseChannel.id;
    }

    if (formulaireRequested) {
      if (Object.keys(changes).length > 0) {
        await saveInscriptionConfig(interaction.guild.id, changes);
        if (interaction.channel?.type === ChannelType.GuildText) {
          await syncRegistrationMessage(
            interaction.guild,
            interaction.channel as TextChannel,
          );
        }
      }

      const updatedConfig = await getInscriptionConfig(interaction.guild.id);
      await interaction.reply({
        embeds: [
          setupEmbed(updatedConfig),
        ],
        components: setupPanelComponents(
          updatedConfig.questions,
          updatedConfig.customQuestions,
        ),
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    await saveInscriptionConfig(interaction.guild.id, changes);
    await interaction.editReply({
      embeds: [await syncAfterSetup(interaction)],
    });
    return;
  }

  await interaction.reply({
    embeds: [setupEmbed(config)],
    components: setupPanelComponents(
      config.questions,
      config.customQuestions,
    ),
    ephemeral: true,
  });
}

async function handlePermissionCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Commande indisponible",
          "Cette commande doit être utilisée dans un serveur.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (!isPrimarySetupUser(interaction.user.id)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Accès refusé",
          "Seuls les administrateurs principaux peuvent gérer les autorisations.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const config = await getInscriptionConfig(interaction.guild.id);
  const memberIds = interaction.options.getString("membres");
  if (memberIds !== null) {
    const authorizedUserIds = parseAuthorizedUserIds(memberIds);
    await saveInscriptionConfig(interaction.guild.id, {
      authorizedUserIds,
    });
    const updatedConfig = { ...config, authorizedUserIds };
    await interaction.reply({
      embeds: [permissionsEmbed(updatedConfig)],
      components: permissionsPanelComponents(updatedConfig),
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    embeds: [permissionsEmbed(config)],
    components: permissionsPanelComponents(config),
    ephemeral: true,
  });
}

async function handlePermissionUserSelect(
  interaction: UserSelectMenuInteraction,
  action: "add" | "remove",
): Promise<void> {
  if (
    !interaction.guild ||
    !isPrimarySetupUser(interaction.user.id)
  ) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Accès refusé",
          "Seuls les administrateurs principaux peuvent gérer ces accès.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const config = await getInscriptionConfig(interaction.guild.id);
  const selectedIds = interaction.values.filter(
    (userId) => !AUTHORIZED_SETUP_USER_IDS.has(userId),
  );
  const authorizedUserIds =
    action === "add"
      ? [...new Set([...config.authorizedUserIds, ...selectedIds])]
      : config.authorizedUserIds.filter(
          (userId) => !selectedIds.includes(userId),
        );

  if (authorizedUserIds.length > 50) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Limite atteinte",
          "La liste ne peut pas dépasser 50 membres autorisés. Retire d'abord quelques accès.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  await saveInscriptionConfig(interaction.guild.id, { authorizedUserIds });
  const updatedConfig = { ...config, authorizedUserIds };
  await interaction.update({
    embeds: [permissionsEmbed(updatedConfig)],
    components: permissionsPanelComponents(updatedConfig),
  });
}

async function handleSendFormCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Commande indisponible",
          "Cette commande doit être utilisée dans un serveur.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const config = await getInscriptionConfig(interaction.guild.id);
  if (!isAuthorizedSetupUser(interaction.user.id, config)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Accès refusé",
          "Tu n'es pas autorisé à publier le formulaire de recrutement.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (
    !interaction.channel ||
    interaction.channel.type !== ChannelType.GuildText
  ) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Salon indisponible",
          "Utilise cette commande dans un salon textuel.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (config.questions.length === 0) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Formulaire non configuré",
          "Configure au moins une question de candidature avec `/setup-inscription` avant de publier le recrutement.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const message = await syncRegistrationMessage(
    interaction.guild,
    interaction.channel,
    interaction.channel,
  );
  await interaction.editReply({
    embeds: [
      successEmbed(
        "Recrutement publié",
        `Le formulaire de candidature a été publié dans <#${message.channelId}>.\n[Ouvrir le message](${message.url})`,
      ),
    ],
  });
}

async function handleSendEmbedCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Commande indisponible",
          "Cette commande doit être utilisée dans un serveur.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (
    !(await isAuthorizedSetupUserForGuild(
      interaction.user.id,
      interaction.guild.id,
    ))
  ) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Accès refusé",
          "Tu n'es pas autorisé à envoyer un embed dans ce serveur.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  let embed: EmbedBuilder;
  try {
    embed = createCustomEmbed({
      title: interaction.options.getString("titre"),
      description: interaction.options.getString("description"),
      color: interaction.options.getString("couleur"),
      imageUrl: interaction.options.getString("image"),
      thumbnailUrl: interaction.options.getString("miniature"),
      footer: interaction.options.getString("footer"),
      footerIconUrl: interaction.options.getString("icone-footer"),
      fieldsJson: interaction.options.getString("champs"),
    });
  } catch (error) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Embed invalide",
          error instanceof Error
            ? error.message
            : "Vérifie les options fournies puis réessaie.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: "✅ Embed envoyé avec succès !",
    ephemeral: true,
  });

  if (interaction.channel?.type === ChannelType.GuildText) {
    await interaction.channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  }
}
async function handleBotInfoCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.reply({
    embeds: [botInfoEmbed()],
    allowedMentions: { parse: [] },
  });
}

async function handleServerInfoCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Commande indisponible",
          "Cette commande doit être utilisée dans un serveur.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const owner = await guild.fetchOwner().catch(() => null);
  if (!owner) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Informations indisponibles",
          "Impossible de récupérer le propriétaire du serveur.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    embeds: [serverInfoEmbed(guild, owner.user)],
    allowedMentions: { parse: [] },
  });
}

function parseFrenchDate(value: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

async function handleStaffAbsenceCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Commande indisponible",
          "Cette commande doit être utilisée dans un serveur.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Vérification impossible",
          "Impossible de vérifier tes rôles dans ce serveur.",
        ),
      ],
    });
    return;
  }

  if (!member.roles.cache.has(STAFF_ABSENCE_ACCESS_ROLE_ID)) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Accès refusé",
          `Cette commande est réservée aux membres ayant le rôle <@&${STAFF_ABSENCE_ACCESS_ROLE_ID}>.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const absenceMaintenance = await getActiveMaintenance("staff-absence");
  if (absenceMaintenance) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Annonce d’absence temporairement indisponible",
          `**Raison :** ${maintenanceReasonLabel(absenceMaintenance.reason)}\n${absenceMaintenance.message || "Aucune précision complémentaire."}\n\n${maintenanceReopenText(absenceMaintenance.endsAt)}`,
        ),
      ],
    });
    return;
  }

  const startDateText = interaction.options.getString("date_debut", true).trim();
  const endDateText = interaction.options.getString("date_fin", true).trim();
  const reason = interaction.options.getString("raison", true).trim();
  const startDate = parseFrenchDate(startDateText);
  const endDate = parseFrenchDate(endDateText);

  if (!startDate || !endDate) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Date invalide",
          "Les dates doivent être réelles et au format JJ/MM/AAAA, par exemple 05/11/2026.",
        ),
      ],
    });
    return;
  }

  if (startDate.getTime() > endDate.getTime()) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Période invalide",
          "La date de début doit être antérieure ou égale à la date de fin.",
        ),
      ],
    });
    return;
  }

  if (!reason) {
    await interaction.editReply({
      embeds: [errorEmbed("Raison manquante", "Indique une raison non vide.")],
    });
    return;
  }

  const absenceChannel = await interaction.client.channels
    .fetch(STAFF_ABSENCE_CHANNEL_ID)
    .catch(() => null);
  if (
    !absenceChannel ||
    absenceChannel.type !== ChannelType.GuildText ||
    absenceChannel.guildId !== guild.id
  ) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Salon indisponible",
          `Le salon d'absence <#${STAFF_ABSENCE_CHANNEL_ID}> est introuvable ou n'est pas un salon textuel.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  try {
    const finishButton = new ButtonBuilder()
      .setCustomId(`${STAFF_ABSENCE_FINISH_BUTTON_PREFIX}${member.id}`)
      .setLabel("Terminer maintenant")
      .setStyle(ButtonStyle.Success);
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      finishButton,
    );

    await absenceChannel.send({
      content: `<@${member.id}>`,
      embeds: [staffAbsenceEmbed(member, startDateText, endDateText, reason)],
      components: [buttonRow],
      allowedMentions: { parse: [], users: [member.id] },
    });
    await interaction.editReply({
      embeds: [
        successEmbed(
          "Absence annoncée",
          `Ton absence a été publiée dans <#${STAFF_ABSENCE_CHANNEL_ID}>.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logger.warn(
      { err: error, guildId: guild.id, userId: member.id },
      "Could not publish staff absence",
    );
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Publication échouée",
          "Impossible de publier l'absence. Vérifie les permissions de Biscotto dans le salon dédié.",
        ),
      ],
    });
  }
}

async function handleStaffAbsenceFinishButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const allowedUserId = interaction.customId.slice(
    STAFF_ABSENCE_FINISH_BUTTON_PREFIX.length,
  );
  if (interaction.user.id !== allowedUserId) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Action réservée",
          "Seule la personne qui a déclaré cette absence peut la terminer.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (processingStaffAbsenceFinishes.has(interaction.message.id)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Action en cours",
          "Cette absence est déjà en train d'être terminée.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const currentEmbed = interaction.message.embeds[0];
  const descriptionLines = currentEmbed?.description?.split(/\r?\n/) ?? [];
  const descriptionStatusIndex = descriptionLines.findIndex((line) =>
    line.startsWith(STAFF_ABSENCE_STATUS_PREFIX),
  );
  const legacyStatusIndex =
    currentEmbed?.fields.findIndex((field) => field.name === "Statut") ?? -1;
  const descriptionStatusIsActive =
    descriptionStatusIndex >= 0 &&
    descriptionLines[descriptionStatusIndex] ===
      `${STAFF_ABSENCE_STATUS_PREFIX}⏳ En cours...`;
  const legacyStatusIsActive =
    legacyStatusIndex >= 0 &&
    currentEmbed?.fields[legacyStatusIndex]?.value === "⏳ En cours...";
  if (
    !currentEmbed ||
    (!descriptionStatusIsActive && !legacyStatusIsActive)
  ) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Absence déjà terminée",
          "Cette absence n'est plus en cours.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  processingStaffAbsenceFinishes.add(interaction.message.id);
  try {
    const updatedEmbed = EmbedBuilder.from(currentEmbed);
    if (descriptionStatusIsActive) {
      descriptionLines[descriptionStatusIndex] =
        `${STAFF_ABSENCE_STATUS_PREFIX}✅ Terminé`;
      updatedEmbed.setDescription(descriptionLines.join("\n"));
    } else {
      updatedEmbed.spliceFields(legacyStatusIndex, 1, {
        name: "Statut",
        value: "✅ Terminé",
        inline: false,
      });
    }
    const disabledButton = new ButtonBuilder()
      .setCustomId(interaction.customId)
      .setLabel("Terminé")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      disabledButton,
    );

    await interaction.update({
      embeds: [updatedEmbed],
      components: [buttonRow],
    });
  } catch (error) {
    logger.warn(
      { err: error, messageId: interaction.message.id },
      "Could not mark staff absence as finished",
    );
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Mise à jour échouée",
          "Impossible de mettre à jour le statut de cette absence.",
        ),
      ],
      ephemeral: true,
    });
    return;
  } finally {
    processingStaffAbsenceFinishes.delete(interaction.message.id);
  }

  let dmSent = true;
  try {
    await interaction.user.send(
      `Ton absence dans **${interaction.guild?.name ?? "le serveur"}** a été marquée comme terminée.`,
    );
  } catch (error) {
    dmSent = false;
    logger.info(
      { err: error, userId: interaction.user.id },
      "Could not send staff absence completion DM",
    );
  }
  await interaction.followUp({
    embeds: [
      dmSent
        ? successEmbed(
            "Absence terminée",
            "Le statut a été mis à jour et un message privé t'a été envoyé.",
          )
        : errorEmbed(
            "Absence terminée",
            "Le statut a été mis à jour, mais je n'ai pas pu t'envoyer de DM. Vérifie tes paramètres de confidentialité.",
          ),
    ],
    ephemeral: true,
  });
}

async function handleRoleActionCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Commande indisponible",
          "Cette commande doit être utilisée dans un serveur.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  let actor: GuildMember;
  try {
    actor = await guild.members.fetch(interaction.user.id);
  } catch {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Vérification impossible",
          "Impossible de vérifier tes rôles dans ce serveur.",
        ),
      ],
    });
    return;
  }

  const hasAccess =
    actor.id === guild.ownerId ||
    actor.permissions.has(PermissionFlagsBits.Administrator) ||
    actor.roles.cache.has(RANK_COMMAND_ACCESS_ROLE_ID);
  if (!hasAccess) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Accès refusé",
          "Cette commande est réservée aux administrateurs, au propriétaire du serveur et aux membres autorisés.",
        ),
      ],
    });
    return;
  }

  const action = interaction.options.getString("action", true);
  if (action !== "rank" && action !== "derank") {
    await interaction.editReply({
      embeds: [errorEmbed("Action invalide", "Choisis Rank ou Derank.")],
    });
    return;
  }

  const targetUser = interaction.options.getUser("membre", true);
  const selectedRole = interaction.options.getRole("role", true);
  const targetRole = await guild.roles.fetch(selectedRole.id).catch(() => null);
  if (!targetRole) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Rôle introuvable",
          "Le rôle sélectionné n’existe plus sur ce serveur.",
        ),
      ],
    });
    return;
  }

  const reason = interaction.options.getString("raison", true).trim();
  if (!reason) {
    await interaction.editReply({
      embeds: [errorEmbed("Raison manquante", "Indique une raison non vide.")],
    });
    return;
  }

  if (
    targetRole.id === guild.id ||
    targetRole.managed ||
    targetRole.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Rôle non autorisé",
          "Le rôle @everyone, les rôles gérés par une intégration et les rôles administrateur ne peuvent pas être modifiés avec cette commande.",
        ),
      ],
    });
    return;
  }

  const announcementChannel = await guild.channels
    .fetch(RANK_ANNOUNCEMENT_CHANNEL_ID)
    .catch(() => null);
  if (!announcementChannel || announcementChannel.type !== ChannelType.GuildText) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Salon d’annonce introuvable",
          `Le salon prévu pour les annonces <#${RANK_ANNOUNCEMENT_CHANNEL_ID}> est introuvable ou n’est pas un salon textuel.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const announcementRole = await guild.roles
    .fetch(RANK_ANNOUNCEMENT_ROLE_ID)
    .catch(() => null);
  if (!announcementRole) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Rôle de notification introuvable",
          `Le rôle de notification <@&${RANK_ANNOUNCEMENT_ROLE_ID}> est introuvable sur ce serveur.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const botMember =
    guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (
    !botMember ||
    !botMember.permissions.has(PermissionFlagsBits.ManageRoles) ||
    targetRole.comparePositionTo(botMember.roles.highest) >= 0
  ) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Permissions insuffisantes",
          "Biscotto doit avoir la permission Gérer les rôles et un rôle supérieur au rôle sélectionné.",
        ),
      ],
    });
    return;
  }

  const channelPermissions = botMember.permissionsIn(announcementChannel);
  if (
    !channelPermissions.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ]) ||
    (!announcementRole.mentionable &&
      !channelPermissions.has(PermissionFlagsBits.MentionEveryone))
  ) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Permissions du salon insuffisantes",
          `Biscotto doit pouvoir voir <#${RANK_ANNOUNCEMENT_CHANNEL_ID}>, y envoyer des embeds et mentionner le rôle de notification.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  let targetMember: GuildMember;
  try {
    targetMember = await guild.members.fetch(targetUser.id);
  } catch {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Membre introuvable",
          "Ce membre ne se trouve plus sur le serveur.",
        ),
      ],
    });
    return;
  }

  if (targetMember.id === guild.ownerId) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Action impossible",
          "Le rôle du propriétaire du serveur ne peut pas être modifié.",
        ),
      ],
    });
    return;
  }

  if (
    botMember &&
    targetMember.roles.highest.comparePositionTo(botMember.roles.highest) >= 0
  ) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Hiérarchie insuffisante",
          "Biscotto ne peut pas modifier les rôles d’un membre dont le rôle le plus élevé est égal ou supérieur au sien.",
        ),
      ],
    });
    return;
  }

  const alreadyHasRole = targetMember.roles.cache.has(targetRole.id);
  if (action === "rank" && alreadyHasRole) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Rôle déjà présent",
          `${targetUser} possède déjà le rôle <@&${targetRole.id}>.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (action === "derank" && !alreadyHasRole) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Rôle absent",
          `${targetUser} ne possède pas le rôle <@&${targetRole.id}>.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  try {
    const auditReason = `${interaction.user.username} (${interaction.user.id}) — ${reason}`;
    if (action === "rank") {
      await targetMember.roles.add(targetRole, auditReason);
    } else {
      await targetMember.roles.remove(targetRole, auditReason);
    }
  } catch (error) {
    logger.warn(
      {
        err: error,
        guildId: guild.id,
        targetUserId: targetUser.id,
        targetRoleId: targetRole.id,
        action,
      },
      "Could not update member role",
    );
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Modification échouée",
          "Discord a refusé la modification du rôle. Vérifie les permissions et la hiérarchie des rôles de Biscotto.",
        ),
      ],
    });
    return;
  }

  try {
    const announcement = await announcementChannel.send({
      content: `<@${targetUser.id}> <@&${RANK_ANNOUNCEMENT_ROLE_ID}>`,
      embeds: [
        rankActionEmbed(
          action,
          targetUser,
          targetRole,
          interaction.user,
          reason,
        ),
      ],
      allowedMentions: {
        parse: [],
        users: [targetUser.id],
        roles: [RANK_ANNOUNCEMENT_ROLE_ID],
      },
    });
    const okayEmoji =
      guild.emojis.cache.find(
        (emoji) => emoji.name?.toLowerCase() === OKAY_EMOJI_NAME,
      )?.toString() ?? "👌";
    await announcement.react(okayEmoji).catch((error: unknown) => {
      logger.warn(
        { err: error, guildId: guild.id, action },
        "Could not add the okay reaction to the rank announcement",
      );
    });
    await interaction.editReply({
      embeds: [
        successEmbed(
          action === "rank" ? "Rank effectué" : "Derank effectué",
          `Le rôle ${targetRole.name} a été ${action === "rank" ? "attribué" : "retiré"} à ${targetUser.username}, et l’annonce a été publiée dans <#${RANK_ANNOUNCEMENT_CHANNEL_ID}>.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logger.error(
      { err: error, guildId: guild.id, targetUserId: targetUser.id, action },
      "Role updated but announcement could not be published",
    );
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Rôle modifié, annonce non publiée",
          `Le rôle a bien été modifié, mais Biscotto n’a pas pu publier l’annonce dans <#${RANK_ANNOUNCEMENT_CHANNEL_ID}>.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
  }
}

async function syncAfterSetup(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
): Promise<ReturnType<typeof successEmbed>> {
  if (!interaction.guild || !interaction.channel?.isTextBased()) {
    return successEmbed(
      "Configuration enregistrée",
      "Utilise la commande dans un salon textuel pour publier le message.",
    );
  }

  const channel = interaction.channel;
  if (channel.type !== ChannelType.GuildText) {
    return successEmbed(
      "Configuration enregistrée",
      "Aucun salon textuel utilisable n'a été trouvé.",
    );
  }

  await syncRegistrationMessage(
    interaction.guild,
    channel as TextChannel,
  );
  return successEmbed(
    "Configuration enregistrée",
    "Le message de recrutement a été mis à jour.",
  );
}

function parseAuthorizedUserIds(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((userId) => userId.trim())
        .filter(
          (userId) =>
            /^\d{17,20}$/.test(userId) &&
            !AUTHORIZED_SETUP_USER_IDS.has(userId),
        ),
    ),
  ].slice(0, 50);
}

function parseCustomQuestionLabels(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((question) => question.trim().replace(/\s+/g, " ").slice(0, 80))
        .filter(Boolean),
    ),
  ].slice(0, 25);
}

async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Action indisponible",
          "Cette action doit être utilisée dans un serveur.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const config = await getInscriptionConfig(interaction.guild.id);
  const isPermissionsModal = interaction.customId === PERMISSIONS_MODAL_ID;
  if (
    interaction.customId.startsWith(SETUP_PREFIX) &&
    (isPermissionsModal
      ? !isPrimarySetupUser(interaction.user.id)
      : !isAuthorizedSetupUser(interaction.user.id, config))
  ) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Accès refusé",
          "Tu n'es pas autorisé à modifier cette configuration.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === `${SETUP_PREFIX}message-modal`) {
    await interaction.deferReply({ ephemeral: true });
    const updatedConfig = await saveInscriptionConfig(interaction.guild.id, {
      messageContent: interaction.fields.getTextInputValue("message-content"),
    });
    await syncAfterSetup(interaction);
    await interaction.editReply({
      embeds: [setupEmbed(updatedConfig)],
      components: setupPanelComponents(
        updatedConfig.questions,
        updatedConfig.customQuestions,
      ),
    });
    return;
  }

  if (interaction.customId === `${SETUP_PREFIX}button-modal`) {
    await interaction.deferReply({ ephemeral: true });
    const updatedConfig = await saveInscriptionConfig(interaction.guild.id, {
      buttonLabel: interaction.fields.getTextInputValue("button-label").trim(),
    });
    await syncAfterSetup(interaction);
    await interaction.editReply({
      embeds: [setupEmbed(updatedConfig)],
      components: setupPanelComponents(
        updatedConfig.questions,
        updatedConfig.customQuestions,
      ),
    });
    return;
  }

  if (interaction.customId === `${SETUP_PREFIX}title-modal`) {
    await interaction.deferReply({ ephemeral: true });
    const updatedConfig = await saveInscriptionConfig(interaction.guild.id, {
      embedTitle: interaction.fields.getTextInputValue("embed-title").trim(),
    });
    await syncAfterSetup(interaction);
    await interaction.editReply({
      embeds: [setupEmbed(updatedConfig)],
      components: setupPanelComponents(
        updatedConfig.questions,
        updatedConfig.customQuestions,
      ),
    });
    return;
  }

  if (interaction.customId === PERMISSIONS_MODAL_ID) {
    await interaction.deferReply({ ephemeral: true });
    const value = interaction.fields.getTextInputValue("authorized-user-ids");
    const authorizedUserIds = parseAuthorizedUserIds(value);
    const updatedConfig = await saveInscriptionConfig(interaction.guild.id, {
      authorizedUserIds,
    });
    await interaction.editReply({
      embeds: [permissionsEmbed(updatedConfig)],
      components: permissionsPanelComponents(updatedConfig),
    });
    return;
  }

  if (interaction.customId === ADD_QUESTION_MODAL_ID) {
    await interaction.deferReply({ ephemeral: true });
    const labels = parseCustomQuestionLabels(
      interaction.fields.getTextInputValue("question-label"),
    );
    if (labels.length === 0) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            "Question manquante",
            "Ajoute au moins une question. Pour en ajouter plusieurs, sépare-les avec des virgules.",
          ),
        ],
      });
      return;
    }

    const config = await getInscriptionConfig(interaction.guild.id);
    const existingLabels = new Set(
      config.customQuestions.map((question) => question.toLowerCase()),
    );
    const newLabels = labels.filter(
      (label) => !existingLabels.has(label.toLowerCase()),
    );
    if (newLabels.length === 0) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            "Questions déjà enregistrées",
            "Toutes les questions saisies existent déjà dans les questions personnalisées.",
          ),
        ],
      });
      return;
    }

    const availableSlots = Math.max(0, 5 - config.questions.length);
    const selectedQuestions = [
      ...config.questions,
      ...newLabels
        .slice(0, availableSlots)
        .map((label) => customQuestionKey(label)),
    ];
    const updatedConfig = await saveInscriptionConfig(interaction.guild.id, {
      questions: selectedQuestions,
      customQuestions: [...config.customQuestions, ...newLabels],
    });
    await interaction.editReply({
      embeds: [setupEmbed(updatedConfig)],
      components: setupPanelComponents(
        updatedConfig.questions,
        updatedConfig.customQuestions,
      ),
    });
    return;
  }

  if (interaction.customId !== MEMBER_MODAL_ID) {
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const recruitmentMaintenance = await getActiveMaintenance("recrutement");
  if (recruitmentMaintenance) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Recrutement temporairement indisponible",
          `**Raison :** ${maintenanceReasonLabel(recruitmentMaintenance.reason)}\n${recruitmentMaintenance.message || "Aucune précision complémentaire."}\n\n${maintenanceReopenText(recruitmentMaintenance.endsAt)}`,
        ),
      ],
    });
    return;
  }

  if (!config.responseChannelId) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Formulaire indisponible",
          "Le salon de réception des candidatures n'est pas encore configuré. Demande à un administrateur d'utiliser `/setup-inscription` puis le sélecteur de salon.",
        ),
      ],
    });
    return;
  }

  const responseChannel = await interaction.guild.channels
    .fetch(config.responseChannelId)
    .catch(() => null);
  if (!responseChannel || responseChannel.type !== ChannelType.GuildText) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Formulaire indisponible",
          "Le salon de réception configuré est introuvable ou inaccessible.",
        ),
      ],
    });
    return;
  }

  const answers = config.questions
    .map((questionId, index) => {
      const inputId = `question:${index}`;
      const answer = interaction.fields.getTextInputValue(inputId);
      return { questionId, answer };
    });

  await responseChannel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [applicationEmbed(interaction.user, answers)],
  });

  await interaction.editReply({
    embeds: [
      successEmbed(
        "Candidature envoyée",
        "Ta candidature a bien été envoyée.",
      ),
    ],
  });
}

async function handleQuestionsSelection(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Action indisponible",
          "Cette action doit être utilisée dans un serveur.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const config = await getInscriptionConfig(interaction.guild.id);
  if (!isAuthorizedSetupUser(interaction.user.id, config)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Accès refusé",
          "Tu n'es pas autorisé à modifier cette configuration.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();
  if (interaction.values.length > 5) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Trop de questions",
          "Discord permet au maximum 5 questions dans un formulaire de candidature.",
        ),
      ],
      components: [],
    });
    return;
  }
  const updatedConfig = await saveInscriptionConfig(interaction.guild.id, {
    questions: interaction.values,
  });

  const channel = interaction.channel;
  if (channel?.type === ChannelType.GuildText) {
    await syncRegistrationMessage(interaction.guild, channel as TextChannel);
  }

  await interaction.editReply({
    embeds: [setupEmbed(updatedConfig)],
    components: setupPanelComponents(
      updatedConfig.questions,
      updatedConfig.customQuestions,
    ),
  });
}

async function handleResponseChannelSelection(
  interaction: ChannelSelectMenuInteraction,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Action indisponible",
          "Cette action doit être utilisée dans un serveur.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const config = await getInscriptionConfig(interaction.guild.id);
  if (!isAuthorizedSetupUser(interaction.user.id, config)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Accès refusé",
          "Tu n'es pas autorisé à modifier cette configuration.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();
  const channelId = interaction.values[0];
  const updatedConfig = await saveInscriptionConfig(interaction.guild.id, {
    responseChannelId: channelId,
  });
  const channel = interaction.channel;
  if (channel?.type === ChannelType.GuildText) {
    await syncRegistrationMessage(interaction.guild, channel as TextChannel);
  }

  await interaction.editReply({
    embeds: [setupEmbed(updatedConfig)],
    components: setupPanelComponents(
      updatedConfig.questions,
      updatedConfig.customQuestions,
    ),
  });
}

function memberRegistrationModal(
  questionIds: string[],
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(MEMBER_MODAL_ID)
    .setTitle("Candidature de recrutement");

  for (const [index, questionId] of questionIds.entries()) {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`question:${index}`)
          .setLabel(questionLabel(questionId).slice(0, 45))
          .setStyle(
            [
              "motivation",
              "discovery",
              "staff-motivation",
              "staff-experience",
              "staff-scenario",
            ].includes(questionId)
              ? TextInputStyle.Paragraph
              : TextInputStyle.Short,
          )
          .setRequired(true)
          .setMaxLength(1000),
      ),
    );
  }

  return modal;
}

export async function startDiscordBot(token: string): Promise<void> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    const statusMessages = [
      "Regarde les tickets",
      "Regarde le staff",
      "Regarde le serveur",
      "Regarde mes messages privés",
    ];
    let statusIndex = 0;
    const updateBotStatus = () => {
      readyClient.user.setPresence({
        activities: [
          {
            name: statusMessages[statusIndex],
            type: ActivityType.Watching,
          },
        ],
        status: "online",
      });
      statusIndex = (statusIndex + 1) % statusMessages.length;
    };
    updateBotStatus();
    setInterval(updateBotStatus, 15_000);
    startMaintenanceExpiryWatcher(readyClient);

    const rest = new REST({ version: "10" }).setToken(token);
    const commandDefinitions = [
      setupCommand.toJSON(),
      setupPermissionCommand.toJSON(),
      sendFormCommand.toJSON(),
      messageCommand.toJSON(),
      botInfoCommand.toJSON(),
      serverInfoCommand.toJSON(),
      staffAbsenceCommand.toJSON(),
      rankDerankCommand.toJSON(),
      maintenanceCommand.toJSON(),
      statusCommand.toJSON(),
    ];

    await rest.put(Routes.applicationCommands(readyClient.user.id), {
      body: [],
    });

    for (const guild of readyClient.guilds.cache.values()) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(readyClient.user.id, guild.id),
          { body: commandDefinitions },
        );

        const config = await getInscriptionConfig(guild.id);
        if (config.registrationChannelId && config.registrationMessageId) {
          const registrationChannel = await guild.channels
            .fetch(config.registrationChannelId)
            .catch(() => null);
          if (registrationChannel?.type === ChannelType.GuildText) {
            await syncRegistrationMessage(
              guild,
              registrationChannel as TextChannel,
            );
          }
        }
      } catch (error) {
        logger.warn(
          { err: error, guildId: guild.id },
          "Could not restrict Discord commands for guild",
        );
      }
    }

    logger.info({ user: readyClient.user.tag }, "Discord bot connected");
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "setup-inscription") {
          await handleSetupCommand(interaction);
        } else if (interaction.commandName === SETUP_PERMISSION_COMMAND_NAME) {
          await handlePermissionCommand(interaction);
        } else if (interaction.commandName === SEND_FORM_COMMAND_NAME) {
          await handleSendFormCommand(interaction);
        } else if (interaction.commandName === MESSAGE_COMMAND_NAME) {
          await handleSendEmbedCommand(interaction);
        } else if (interaction.commandName === BOT_INFO_COMMAND_NAME) {
          await handleBotInfoCommand(interaction);
        } else if (interaction.commandName === SERVER_INFO_COMMAND_NAME) {
          await handleServerInfoCommand(interaction);
        } else if (interaction.commandName === STAFF_ABSENCE_COMMAND_NAME) {
          await handleStaffAbsenceCommand(interaction);
        } else if (interaction.commandName === RANK_DERANK_COMMAND_NAME) {
          await handleRoleActionCommand(interaction);
        } else if (interaction.commandName === MAINTENANCE_COMMAND_NAME) {
          const canManageMaintenance =
            MAINTENANCE_ALLOWED_USER_IDS.has(interaction.user.id) ||
            [...MAINTENANCE_ALLOWED_ROLE_IDS].some((roleId) =>
              interactionHasRole(interaction, roleId),
            );
          if (!canManageMaintenance) {
            await interaction.reply({
              embeds: [
                errorEmbed(
                  "Accès refusé",
                  "Cette commande est réservée au membre autorisé.",
                ),
              ],
              ephemeral: true,
            });
          } else {
            await handleMaintenanceCommand(interaction);
          }
        } else if (interaction.commandName === STATUS_COMMAND_NAME) {
          const canViewStatus =
            interaction.user.id === STATUS_ALLOWED_USER_ID ||
            [...STATUS_ALLOWED_ROLE_IDS].some((roleId) =>
              interactionHasRole(interaction, roleId),
            );
          if (!canViewStatus) {
            await interaction.reply({
              embeds: [
                errorEmbed(
                  "Accès refusé",
                  "Tu n’es pas autorisé à consulter l’état des services.",
                ),
              ],
              ephemeral: true,
            });
          } else {
            await handleStatusCommand(interaction);
          }
        }
        return;
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(STAFF_ABSENCE_FINISH_BUTTON_PREFIX)
      ) {
        await handleStaffAbsenceFinishButton(interaction);
        return;
      }

      if (
        interaction.isButton() &&
        isModmailButton(interaction.customId)
      ) {
        await handleModmailButton(interaction, client);
        return;
      }

      if (
        interaction.isButton() &&
        interaction.customId === PREVIEW_SETUP_BUTTON_ID
      ) {
        if (
          !interaction.guild ||
          !(await isAuthorizedSetupUserForGuild(
            interaction.user.id,
            interaction.guild.id,
          ))
        ) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                "Accès refusé",
                "Tu n'es pas autorisé à prévisualiser ce recrutement.",
              ),
            ],
            ephemeral: true,
          });
          return;
        }

        const config = await getInscriptionConfig(interaction.guild.id);
        const recruitmentMaintenance =
          await getActiveMaintenance("recrutement");
        await interaction.reply({
          embeds: [
            registrationEmbed(
              config.embedTitle,
              config.messageContent,
              config.buttonLabel,
              config.questions,
              interaction.guild,
              Boolean(config.responseChannelId && config.questions.length > 0),
              recruitmentMaintenance ?? undefined,
            ),
          ],
          components: [registrationComponents(config.buttonLabel, true)[0]],
          ephemeral: true,
        });
        return;
      }

      if (
        interaction.isButton() &&
        interaction.customId === MESSAGE_SETUP_BUTTON_ID
      ) {
        if (
          !interaction.guild ||
          !(await isAuthorizedSetupUserForGuild(
            interaction.user.id,
            interaction.guild.id,
          ))
        ) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                "Accès refusé",
                "Tu n'es pas autorisé à modifier cette configuration.",
              ),
            ],
            ephemeral: true,
          });
          return;
        }

        const config = await getInscriptionConfig(interaction.guild.id);
        await interaction.showModal(messageModal(config.messageContent));
        return;
      }

      if (
        interaction.isButton() &&
        interaction.customId === BUTTON_SETUP_BUTTON_ID
      ) {
        if (
          !interaction.guild ||
          !(await isAuthorizedSetupUserForGuild(
            interaction.user.id,
            interaction.guild.id,
          ))
        ) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                "Accès refusé",
                "Tu n'es pas autorisé à modifier cette configuration.",
              ),
            ],
            ephemeral: true,
          });
          return;
        }

        const config = await getInscriptionConfig(interaction.guild.id);
        await interaction.showModal(buttonModal(config.buttonLabel));
        return;
      }

      if (
        interaction.isButton() &&
        interaction.customId === TITLE_SETUP_BUTTON_ID
      ) {
        if (
          !interaction.guild ||
          !(await isAuthorizedSetupUserForGuild(
            interaction.user.id,
            interaction.guild.id,
          ))
        ) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                "Accès refusé",
                "Tu n'es pas autorisé à modifier cette configuration.",
              ),
            ],
            ephemeral: true,
          });
          return;
        }

        const config = await getInscriptionConfig(interaction.guild.id);
        await interaction.showModal(titleModal(config.embedTitle));
        return;
      }

      if (
        interaction.isButton() &&
        interaction.customId === PERMISSIONS_SETUP_BUTTON_ID
      ) {
        if (
          !interaction.guild ||
          !isPrimarySetupUser(interaction.user.id)
        ) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                "Accès refusé",
                "Seuls les administrateurs principaux peuvent gérer les accès.",
              ),
            ],
            ephemeral: true,
          });
          return;
        }

        const config = await getInscriptionConfig(interaction.guild.id);
        await interaction.showModal(permissionsModal(config));
        return;
      }

      if (
        interaction.isButton() &&
        interaction.customId === ADD_QUESTION_SETUP_BUTTON_ID
      ) {
        if (
          !interaction.guild ||
          !(await isAuthorizedSetupUserForGuild(
            interaction.user.id,
            interaction.guild.id,
          ))
        ) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                "Accès refusé",
                "Tu n'es pas autorisé à modifier cette configuration.",
              ),
            ],
            ephemeral: true,
          });
          return;
        }

        await interaction.showModal(addQuestionModal());
        return;
      }

      if (interaction.isButton() && interaction.customId === REGISTRATION_BUTTON_ID) {
        if (!interaction.guild) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                "Formulaire indisponible",
                "Cette action doit être utilisée dans un serveur.",
              ),
            ],
            ephemeral: true,
          });
          return;
        }

        const config = await getInscriptionConfig(interaction.guild.id);
        const recruitmentMaintenance =
          await getActiveMaintenance("recrutement");
        if (recruitmentMaintenance) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                "Recrutement temporairement indisponible",
                `**Raison :** ${maintenanceReasonLabel(recruitmentMaintenance.reason)}\n${recruitmentMaintenance.message || "Aucune précision complémentaire."}\n\n${maintenanceReopenText(recruitmentMaintenance.endsAt)}`,
              ),
            ],
            ephemeral: true,
          });
          return;
        }
        if (config.questions.length === 0) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                "Formulaire indisponible",
                "Le formulaire de recrutement n'est pas encore configuré.",
              ),
            ],
            ephemeral: true,
          });
          return;
        }

        await interaction.showModal(memberRegistrationModal(config.questions));
        return;
      }

      if (interaction.isModalSubmit()) {
        if (isModmailModal(interaction.customId)) {
          await handleModmailModal(interaction, client);
          return;
        }

        await handleModalSubmit(interaction);
        return;
      }

      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === QUESTION_SELECT_ID) {
          await handleQuestionsSelection(interaction);
        }
      }

      if (interaction.isUserSelectMenu()) {
        if (interaction.customId === ADD_PERMISSION_USER_SELECT_ID) {
          await handlePermissionUserSelect(interaction, "add");
          return;
        }
        if (interaction.customId === REMOVE_PERMISSION_USER_SELECT_ID) {
          await handlePermissionUserSelect(interaction, "remove");
          return;
        }
      }

      if (
        interaction.isChannelSelectMenu() &&
        interaction.customId === RESPONSE_CHANNEL_SELECT_ID
      ) {
        await handleResponseChannelSelection(interaction);
      }
    } catch (error) {
      logger.error({ err: error }, "Discord interaction failed");
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          embeds: [
            errorEmbed(
              "Erreur",
              "Une erreur est survenue. Réessaie dans un instant.",
            ),
          ],
          ephemeral: true,
        });
      }
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (await handleModmailMessage(message, client)) {
        return;
      }

      if (
        message.author.bot ||
        !message.guild ||
        !client.user ||
        !message.mentions.users.has(client.user.id)
      ) {
        return;
      }

      const botMentionPattern = new RegExp(`<@!?${client.user.id}>`, "g");
      const botMentions = message.content.match(botMentionPattern) ?? [];
      if (
        botMentions.length !== 1 ||
        message.content.replace(botMentionPattern, "").trim().length > 0 ||
        message.attachments.size > 0 ||
        message.stickers.size > 0
      ) {
        return;
      }

      if (message.mentions.repliedUser?.id === client.user.id) {
        return;
      }
      if (message.reference?.messageId) {
        const referencedMessage = await message
          .fetchReference()
          .catch(() => null);
        if (referencedMessage?.author.id === client.user.id) {
          return;
        }
      }

      await message.reply({
        embeds: [commandsHelpEmbed(`<@${message.author.id}>`)],
        allowedMentions: { repliedUser: false },
      });
    } catch (error) {
      logger.warn({ err: error }, "Could not reply to bot mention");
    }
  });

  await client.login(token);
}

export { DEFAULT_BUTTON_LABEL, DEFAULT_MESSAGE };