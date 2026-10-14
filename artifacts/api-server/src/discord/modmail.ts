import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type Message,
  type ThreadChannel,
  type User,
} from "discord.js";
import { logger } from "../lib/logger";
import {
  claimModmailConversation,
  createModmailConversation,
  getActiveModmailForUser,
  getModmailByThreadId,
  saveModmailReview,
  setModmailReviewMessageId,
  unclaimModmailConversation,
  updateModmailStatus,
} from "./modmail-store";
import {
  getActiveMaintenance,
  maintenanceReasonLabel,
} from "./maintenance-store";

export const MODMAIL_FORUM_CHANNEL_ID = "1553737848908292157";
export const MODMAIL_SUPPORT_ROLE_ID = "1429063878700175471";
export const MODMAIL_MENTION_ROLE_ID = "1429063878700175471";
export const MODMAIL_SUPPORT_ROLE_IDS = new Set([
  MODMAIL_SUPPORT_ROLE_ID,
  "1529149444887543909",
  "1429063286657384660",
  "1429508546550038648",
]);

export const MODMAIL_CLOSED_TAG_ID = "1553738990568480778";
export const MODMAIL_OPEN_TAG_ID = "1553738877003501619";
export const MODMAIL_CLAIMED_TAG_ID = "1553739246479609936";
export const MODMAIL_PENDING_TAG_ID = "1553738933752307712";

export const MODMAIL_CONFIRM_ID = "modmail:confirm";
export const MODMAIL_CANCEL_ID = "modmail:cancel";
export const MODMAIL_CLAIM_ID = "modmail:claim";
export const MODMAIL_UNCLAIM_ID = "modmail:unclaim";
export const MODMAIL_CLOSE_ID = "modmail:close";
export const MODMAIL_CLOSE_CONFIRM_ID = "modmail:close:confirm";
export const MODMAIL_CLOSE_CANCEL_ID = "modmail:close:cancel";
export const MODMAIL_REPLY_ID = "modmail:reply";
export const MODMAIL_REPLY_MODAL_ID = "modmail:reply-modal";
export const MODMAIL_REVIEW_RATING_PREFIX = "modmail:review:rate:";
export const MODMAIL_REVIEW_MODAL_PREFIX = "modmail:review:modal:";
export const MODMAIL_REVIEW_CONFIRM_PREFIX = "modmail:review:confirm:";
export const MODMAIL_REVIEW_EDIT_PREFIX = "modmail:review:edit:";

type ReviewContext = {
  threadId: string;
  rating: number;
  promptMessageId: string;
};

type PendingConfirmation = {
  content: string;
  prompt: Message;
};

const pendingConfirmations = new Map<string, PendingConfirmation>();
const processingReviews = new Set<string>();

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function messageContent(message: Message): string {
  const parts = [
    message.content.trim(),
    ...message.attachments.map((attachment) => attachment.url),
  ].filter(Boolean);

  return parts.join("\n") || "Message sans texte.";
}

function userLabel(user: User): string {
  return user.tag || user.username;
}

function userMessageEmbed(
  user: User,
  content: string,
  title = "Nouveau message de support",
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf2b2a8)
    .setTitle(title)
    .setDescription(truncate(content, 4096))
    .addFields({
      name: "Utilisateur",
      value: `${userLabel(user)}\n\`${user.id}\``,
      inline: false,
    })
    .setTimestamp();
}

function supportReplyEmbed(content: string, moderatorName: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xa8c7f2)
    .setTitle("Message du support")
    .setDescription(truncate(content, 4096))
    .setFooter({ text: moderatorName });
}

function confirmationEmbed(content: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf2b2a8)
    .setTitle("Contacter le support ?")
    .setDescription(
      `Ton message sera transmis au support dans un espace privé.\n\n> ${truncate(content, 900)}`,
    );
}

function statusEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf2b2a8)
    .setTitle(title)
    .setDescription(description);
}

function confirmationComponents(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(MODMAIL_CONFIRM_ID)
        .setLabel("Contacter le support")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(MODMAIL_CANCEL_ID)
        .setLabel("Annuler")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function threadControls(
  includeClaimButton = true,
  claimButtonDisabled = false,
  includeUnclaimButton = false,
): ActionRowBuilder<ButtonBuilder>[] {
  const buttons: ButtonBuilder[] = [];
  if (includeClaimButton) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(MODMAIL_CLAIM_ID)
        .setLabel("Prendre en charge")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(claimButtonDisabled),
    );
  }

  if (includeUnclaimButton) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(MODMAIL_UNCLAIM_ID)
        .setLabel("Retirer la prise en charge")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(MODMAIL_REPLY_ID)
      .setLabel("Répondre")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(MODMAIL_CLOSE_ID)
      .setLabel("Fermer")
      .setStyle(ButtonStyle.Danger),
  );

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons),
  ];
}

function closeConfirmationComponents(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(MODMAIL_CLOSE_CONFIRM_ID)
        .setLabel("Confirmer la fermeture")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(MODMAIL_CLOSE_CANCEL_ID)
        .setLabel("Annuler")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function reviewRatingEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf2b2a8)
    .setTitle("Comment s’est passée ta demande ?")
    .setDescription(
      "Ton ticket vient d’être fermé. Choisis une note, puis partage ton expérience pour aider l’équipe à s’améliorer.",
    )
    .setFooter({ text: "Ton avis sera publié dans le ticket, avec ta note." });
}

function reviewRatingComponents(
  threadId: string,
): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = [1, 2, 3, 4, 5].map((rating) =>
    new ButtonBuilder()
      .setCustomId(`${MODMAIL_REVIEW_RATING_PREFIX}${threadId}:${rating}`)
      .setLabel(`${rating} ⭐`)
      .setStyle(ButtonStyle.Secondary),
  );
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
}

function reviewModal(
  context: ReviewContext,
  initialReview?: string,
): ModalBuilder {
  const reviewInput = new TextInputBuilder()
    .setCustomId("review-content")
    .setLabel("Comment s’est passée ton expérience ?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(1000)
    .setPlaceholder("Dis-nous ce qui a bien fonctionné ou ce qu’on peut améliorer…");
  if (initialReview) {
    reviewInput.setValue(initialReview.slice(0, 1000));
  }

  return new ModalBuilder()
    .setCustomId(
      `${MODMAIL_REVIEW_MODAL_PREFIX}${context.threadId}:${context.rating}:${context.promptMessageId}`,
    )
    .setTitle(`Ton avis • ${context.rating}/5 étoiles`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(reviewInput),
    );
}

function reviewPreviewEmbed(rating: number, review: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf2b2a8)
    .setTitle("Confirme ton avis")
    .setDescription(
      "Vérifie ton commentaire. En validant, tu l’ajouteras au post de ton ticket avec ta note.",
    )
    .addFields(
      {
        name: "Ta note",
        value: `${"⭐".repeat(rating)} (${rating}/5)`,
        inline: false,
      },
      {
        name: "Ton avis",
        value: review.slice(0, 1000),
        inline: false,
      },
    );
}

function reviewPreviewComponents(
  context: ReviewContext,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `${MODMAIL_REVIEW_CONFIRM_PREFIX}${context.threadId}:${context.rating}:${context.promptMessageId}`,
        )
        .setLabel("Valider mon avis")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(
          `${MODMAIL_REVIEW_EDIT_PREFIX}${context.threadId}:${context.rating}:${context.promptMessageId}`,
        )
        .setLabel("Modifier")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function parseReviewContext(
  customId: string,
  prefix: string,
): ReviewContext | null {
  const match = customId.match(
    new RegExp(`^${prefix}(\\d{17,20}):([1-5]):(\\d{17,20})$`),
  );
  if (!match) {
    return null;
  }

  return {
    threadId: match[1],
    rating: Number(match[2]),
    promptMessageId: match[3],
  };
}

function reviewStatusEmbed(
  title: string,
  description: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf2b2a8)
    .setTitle(title)
    .setDescription(description);
}

function modmailReviewEmbed(
  user: User,
  rating: number,
  review: string,
  moderatorId: string | null,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf2b2a8)
    .setTitle("Avis sur le support")
    .setDescription(truncate(review, 4096))
    .addFields(
      {
        name: "Membre",
        value: `${user.globalName ?? user.username} (<@${user.id}>)`,
        inline: true,
      },
      {
        name: "Note",
        value: `${"⭐".repeat(rating)} (${rating}/5)`,
        inline: true,
      },
      {
        name: "Modérateur",
        value: moderatorId ? `<@${moderatorId}>` : "Aucun modérateur désigné",
        inline: false,
      },
    )
    .setFooter({ text: "Avis validé • Modmail" })
    .setTimestamp();
}

function replyModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(MODMAIL_REPLY_MODAL_ID)
    .setTitle("Répondre à l'utilisateur")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reply-content")
          .setLabel("Message à envoyer")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000)
          .setPlaceholder("Écris la réponse du support..."),
      ),
    );
}

function isModmailThread(message: Message): boolean {
  return (
    message.channel.isThread() &&
    message.channel.parentId === MODMAIL_FORUM_CHANNEL_ID
  );
}

function isSupportButton(customId: string): boolean {
  return [
    MODMAIL_CLAIM_ID,
    MODMAIL_UNCLAIM_ID,
    MODMAIL_REPLY_ID,
    MODMAIL_CLOSE_ID,
    MODMAIL_CLOSE_CONFIRM_ID,
    MODMAIL_CLOSE_CANCEL_ID,
  ].includes(customId);
}

async function supportMember(
  interaction: ButtonInteraction | ModalSubmitInteraction,
): Promise<boolean> {
  if (!interaction.guild) {
    return false;
  }

  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);
  return (
    member?.roles.cache.some((role) =>
      MODMAIL_SUPPORT_ROLE_IDS.has(role.id),
    ) ?? false
  );
}

async function createTicket(
  client: Client,
  user: User,
  content: string,
): Promise<ThreadChannel> {
  const forum = await client.channels.fetch(MODMAIL_FORUM_CHANNEL_ID);
  if (!forum || forum.type !== ChannelType.GuildForum) {
    throw new Error(
      `Mod mail forum channel ${MODMAIL_FORUM_CHANNEL_ID} is unavailable or is not a forum.`,
    );
  }

  const safeName = user.username.replace(/[^a-z0-9-]/gi, "-").slice(0, 70);
  const thread = await forum.threads.create({
    name: `support-${safeName || user.id}`,
    appliedTags: [MODMAIL_OPEN_TAG_ID, MODMAIL_PENDING_TAG_ID],
    reason: `Mod mail ouvert pour ${user.tag} (${user.id})`,
    message: {
      content: `<@&${MODMAIL_MENTION_ROLE_ID}>`,
      embeds: [userMessageEmbed(user, content)],
      components: threadControls(),
      allowedMentions: { roles: [MODMAIL_MENTION_ROLE_ID] },
    },
  });

  await createModmailConversation(user.id, thread.id);
  return thread;
}

async function sendPendingConfirmation(
  message: Message,
  content: string,
): Promise<void> {
  const payload = {
    embeds: [confirmationEmbed(content)],
    components: confirmationComponents(),
  };
  const pending = pendingConfirmations.get(message.author.id);

  if (pending) {
    const prompt = await pending.prompt.edit(payload).catch(() => null);
    if (prompt) {
      pending.content = content;
      pending.prompt = prompt;
      return;
    }
  }

  const prompt = await message.author.send(payload);
  pendingConfirmations.set(message.author.id, { content, prompt });
}

async function handleDirectMessage(
  message: Message,
  client: Client,
): Promise<void> {
  const supportMaintenance = await getActiveMaintenance("support");
  if (supportMaintenance) {
    const availabilityText = supportMaintenance.endsAt
      ? `Le support sera de nouveau disponible <t:${Math.floor(supportMaintenance.endsAt.getTime() / 1000)}:F> (<t:${Math.floor(supportMaintenance.endsAt.getTime() / 1000)}:R>).`
      : "Le support restera indisponible jusqu’à sa réactivation manuelle.";
    await message.react("⏳").catch(() => undefined);
    await message.reply({
      embeds: [
        statusEmbed(
          "Support temporairement indisponible",
          `**Raison :** ${maintenanceReasonLabel(supportMaintenance.reason)}\n${supportMaintenance.message || "Aucune précision complémentaire."}\n\n${availabilityText}`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  await message.react("✅").catch(() => undefined);
  const content = messageContent(message);
  const activeConversation = await getActiveModmailForUser(message.author.id);

  if (activeConversation) {
    const thread = await client.channels
      .fetch(activeConversation.threadId)
      .catch(() => null);
    if (thread?.isThread() && !thread.archived) {
      await thread.send({
        embeds: [userMessageEmbed(message.author, content, "Message utilisateur")],
        components: threadControls(false),
        allowedMentions: { parse: [] },
      });
      return;
    }

    await updateModmailStatus(activeConversation.threadId, "closed");
  }

  await sendPendingConfirmation(message, content);
}

async function handleSupportMessage(
  message: Message,
  _client: Client,
): Promise<void> {
  // Staff messages typed directly in the forum stay internal. Only the
  // "Répondre" modal sends a message to the user.
  void message;
}

async function handleConfirmationButton(
  interaction: ButtonInteraction,
  client: Client,
): Promise<void> {
  await interaction.deferUpdate();
  const pending = pendingConfirmations.get(interaction.user.id);

  if (!pending) {
    await interaction.editReply({
      embeds: [
        statusEmbed(
          "Confirmation expirée",
          "Envoie un nouveau message au bot pour créer une demande.",
        ),
      ],
      components: [],
    });
    return;
  }

  try {
    const existingConversation = await getActiveModmailForUser(
      interaction.user.id,
    );
    if (existingConversation) {
      pendingConfirmations.delete(interaction.user.id);
      await interaction.editReply({
        embeds: [
          statusEmbed(
            "Demande déjà ouverte",
            "Ton message a été transmis dans ta demande existante.",
          ),
        ],
        components: [],
      });
      return;
    }

    await createTicket(client, interaction.user, pending.content);
    pendingConfirmations.delete(interaction.user.id);
    await interaction.editReply({
      embeds: [
        statusEmbed(
          "Demande envoyée",
          "Ton message a été transmis au support. Tu peux continuer à répondre ici.",
        ),
      ],
      components: [],
    });
  } catch (error) {
    logger.error({ err: error, userId: interaction.user.id }, "Could not create mod mail ticket");
    await interaction.editReply({
      embeds: [
        statusEmbed(
          "Impossible d'envoyer la demande",
          "Le support est momentanément indisponible. Réessaie dans un instant.",
        ),
      ],
      components: [],
    });
  }
}

async function handleSupportButton(
  interaction: ButtonInteraction,
  client: Client,
): Promise<void> {
  if (!interaction.guild || !interaction.channel?.isThread()) {
    await interaction.reply({
      embeds: [
        statusEmbed(
          "Action indisponible",
          "Cette action doit être utilisée dans un ticket du support.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (!(await supportMember(interaction))) {
    await interaction.reply({
      embeds: [
        statusEmbed(
          "Accès refusé",
          "Seuls les membres du support peuvent gérer ce ticket.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const thread = interaction.channel;
  if (thread.parentId !== MODMAIL_FORUM_CHANNEL_ID) {
    await interaction.reply({
      embeds: [statusEmbed("Action indisponible", "Ce salon n'est pas un ticket mod mail.")],
      ephemeral: true,
    });
    return;
  }

  const conversation = await getModmailByThreadId(thread.id);
  if (!conversation || conversation.status === "closed") {
    await interaction.reply({
      embeds: [
        statusEmbed(
          "Ticket introuvable",
          "Ce ticket est déjà fermé ou n'est plus disponible.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === MODMAIL_CLAIM_ID) {
    if (conversation.status === "claimed") {
      await interaction.reply({
        embeds: [
          statusEmbed(
            "Ticket déjà pris en charge",
            conversation.claimedByUserId
              ? `Ce ticket est déjà pris en charge par <@${conversation.claimedByUserId}>.`
              : "Ce ticket est déjà pris en charge par un membre du support.",
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    const claimed = await claimModmailConversation(
      thread.id,
      interaction.user.id,
    );
    if (!claimed) {
      await interaction.reply({
        embeds: [
          statusEmbed(
            "Ticket déjà pris en charge",
            "Un autre membre du support vient de prendre ce ticket.",
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    await thread.setAppliedTags([MODMAIL_OPEN_TAG_ID, MODMAIL_CLAIMED_TAG_ID]);

    const moderator = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
    const moderatorName = moderator?.displayName ?? interaction.user.username;
    const starterMessage = await thread.fetchStarterMessage().catch(() => null);
    if (starterMessage) {
      const claimedEmbed = starterMessage.embeds[0]
        ? EmbedBuilder.from(starterMessage.embeds[0])
        : userMessageEmbed(
            await client.users.fetch(conversation.userId),
            "Demande de support",
          );
      claimedEmbed
        .addFields({
          name: "Pris en charge par",
          value: `${moderatorName} (<@${interaction.user.id}>)`,
          inline: false,
        })
        .setFooter({ text: `Pris en charge par ${moderatorName}` });
      await starterMessage.edit({
        embeds: [claimedEmbed],
        components: threadControls(true, true, true),
        allowedMentions: { parse: [] },
      });
    }

    const user = await client.users.fetch(conversation.userId);
    await user
      .send({
        embeds: [
          statusEmbed(
            "Demande prise en charge",
            "Un membre du support prend maintenant en charge ta demande.",
          ),
        ],
      })
      .catch(() => undefined);

    await interaction.reply({
      embeds: [
        statusEmbed(
          "Ticket pris en charge",
          `${interaction.user} est maintenant en charge de cette demande.`,
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === MODMAIL_UNCLAIM_ID) {
    if (conversation.status !== "claimed") {
      await interaction.reply({
        embeds: [
          statusEmbed(
            "Ticket non pris en charge",
            "Ce ticket n'est pas actuellement pris en charge.",
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    const unclaimed = await unclaimModmailConversation(thread.id);
    if (!unclaimed) {
      await interaction.reply({
        embeds: [
          statusEmbed(
            "Action impossible",
            "La prise en charge a déjà été retirée par un autre membre du support.",
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    await thread.setAppliedTags([MODMAIL_OPEN_TAG_ID, MODMAIL_PENDING_TAG_ID]);

    const starterMessage = await thread.fetchStarterMessage().catch(() => null);
    if (starterMessage) {
      const unclaimedEmbed = starterMessage.embeds[0]
        ? EmbedBuilder.from(starterMessage.embeds[0])
        : userMessageEmbed(
            await client.users.fetch(conversation.userId),
            "Demande de support",
          );
      const claimedByFieldIndex =
        unclaimedEmbed.data.fields?.findIndex(
          (field) => field.name === "Pris en charge par",
        ) ?? -1;
      if (claimedByFieldIndex >= 0) {
        unclaimedEmbed.spliceFields(claimedByFieldIndex, 1);
      }
      unclaimedEmbed.data.footer = undefined;
      await starterMessage.edit({
        embeds: [unclaimedEmbed],
        components: threadControls(),
        allowedMentions: { parse: [] },
      });
    }

    await interaction.reply({
      embeds: [
        statusEmbed(
          "Prise en charge retirée",
          "Le ticket est de nouveau disponible pour le support.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === MODMAIL_REPLY_ID) {
    await interaction.showModal(replyModal());
    return;
  }

  if (interaction.customId === MODMAIL_CLOSE_ID) {
    await interaction.reply({
      embeds: [
        statusEmbed(
          "Confirmer la fermeture",
          "Cette action ferme le ticket et applique le tag « Fermer ».",
        ),
      ],
      components: closeConfirmationComponents(),
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === MODMAIL_CLOSE_CANCEL_ID) {
    await interaction.update({
      embeds: [statusEmbed("Fermeture annulée", "Le ticket reste ouvert.")],
      components: [],
    });
    return;
  }

  await thread.setAppliedTags([MODMAIL_CLOSED_TAG_ID]);
  await updateModmailStatus(thread.id, "closed");
  await thread.send({
    content: "Ticket clôturé et tag appliqué !",
    allowedMentions: { parse: [] },
  });

  const user = await client.users.fetch(conversation.userId);
  await user
    .send({
      embeds: [reviewRatingEmbed()],
      components: reviewRatingComponents(thread.id),
    })
    .catch((error) => {
      logger.warn(
        { err: error, userId: conversation.userId, threadId: thread.id },
        "Could not send mod mail review invitation",
      );
    });

  await interaction.update({
    embeds: [statusEmbed("Ticket fermé", "Le ticket est maintenant fermé.")],
    components: [],
  });
  await thread.setLocked(true).catch((error) => {
    logger.warn(
      { err: error, threadId: thread.id },
      "Could not lock closed mod mail thread",
    );
  });
  await thread.setArchived(true).catch((error) => {
    logger.warn(
      { err: error, threadId: thread.id },
      "Could not archive closed mod mail thread",
    );
  });
}

async function handleReviewRatingButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const match = interaction.customId.match(
    /^modmail:review:rate:(\d{17,20}):([1-5])$/,
  );
  if (!match) {
    await interaction.reply({
      embeds: [reviewStatusEmbed("Action indisponible", "Cette note n’est pas valide.")],
    });
    return;
  }

  const context: ReviewContext = {
    threadId: match[1],
    rating: Number(match[2]),
    promptMessageId: interaction.message.id,
  };
  const conversation = await getModmailByThreadId(context.threadId);
  if (
    !conversation ||
    conversation.userId !== interaction.user.id ||
    conversation.status !== "closed"
  ) {
    await interaction.reply({
      embeds: [
        reviewStatusEmbed(
          "Avis indisponible",
          "Cette demande est introuvable ou n’est plus ouverte aux avis.",
        ),
      ],
    });
    return;
  }

  if (conversation.reviewRating !== null) {
    await interaction.update({
      embeds: [
        reviewStatusEmbed(
          "Avis déjà validé",
          "Un avis a déjà été envoyé pour ce ticket.",
        ),
      ],
      components: [],
    });
    return;
  }

  await interaction.showModal(reviewModal(context));
}

async function handleReviewEditButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const context = parseReviewContext(
    interaction.customId,
    MODMAIL_REVIEW_EDIT_PREFIX,
  );
  const conversation = context
    ? await getModmailByThreadId(context.threadId)
    : undefined;
  if (
    !context ||
    !conversation ||
    conversation.userId !== interaction.user.id ||
    conversation.status !== "closed" ||
    conversation.reviewRating !== null
  ) {
    await interaction.reply({
      embeds: [
        reviewStatusEmbed(
          "Modification indisponible",
          "Cet avis a déjà été envoyé ou n’est plus modifiable.",
        ),
      ],
    });
    return;
  }

  const review = interaction.message.embeds[0]?.fields.find(
    (field) => field.name === "Ton avis",
  )?.value;
  if (!review) {
    await interaction.reply({
      embeds: [
        reviewStatusEmbed(
          "Avis introuvable",
          "Rouvre le formulaire depuis le message de demande d’avis.",
        ),
      ],
    });
    return;
  }

  await interaction.showModal(reviewModal(context, review));
}

async function handleReviewModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  await interaction.deferReply();
  let threadId: string | undefined;
  try {
    const context = parseReviewContext(
      interaction.customId,
      MODMAIL_REVIEW_MODAL_PREFIX,
    );
    threadId = context?.threadId;
    const conversation = context
      ? await getModmailByThreadId(context.threadId)
      : undefined;
    if (
      !context ||
      !conversation ||
      conversation.userId !== interaction.user.id ||
      conversation.status !== "closed"
    ) {
      await interaction.editReply({
        embeds: [
          reviewStatusEmbed(
            "Avis indisponible",
            "Ce formulaire ne correspond pas à un ticket fermé par le support.",
          ),
        ],
      });
      return;
    }

    if (conversation.reviewRating !== null) {
      await interaction.editReply({
        embeds: [
          reviewStatusEmbed(
            "Avis déjà envoyé",
            "Un seul avis peut être validé pour chaque ticket.",
          ),
        ],
      });
      return;
    }

    const review = interaction.fields
      .getTextInputValue("review-content")
      .trim();
    if (!review) {
      await interaction.editReply({
        embeds: [
          reviewStatusEmbed(
            "Avis vide",
            "Écris au moins un caractère avant de continuer.",
          ),
        ],
      });
      return;
    }

    await interaction.editReply({
      embeds: [reviewPreviewEmbed(context.rating, review)],
      components: reviewPreviewComponents(context),
    });
  } catch (error) {
    logger.error(
      { err: error, threadId, userId: interaction.user.id },
      "Could not process mod mail review form",
    );
    await interaction
      .editReply({
        embeds: [
          reviewStatusEmbed(
            "Avis indisponible",
            "Le formulaire n’a pas pu être traité. Réessaie dans un instant.",
          ),
        ],
      })
      .catch(() => undefined);
  }
}

async function publishModmailReview(
  client: Client,
  conversation: NonNullable<Awaited<ReturnType<typeof getModmailByThreadId>>>,
  user: User,
  rating: number,
  review: string,
): Promise<string> {
  const channel = await client.channels.fetch(conversation.threadId).catch(() => null);
  if (!channel?.isThread()) {
    throw new Error(`Mod mail thread ${conversation.threadId} is unavailable.`);
  }

  const thread = channel as ThreadChannel;
  try {
    await thread.setArchived(false);
    await thread.setLocked(false);
    const reviewMessage = await thread.send({
      content: conversation.claimedByUserId
        ? `<@${conversation.claimedByUserId}>`
        : undefined,
      embeds: [
        modmailReviewEmbed(
          user,
          rating,
          review,
          conversation.claimedByUserId,
        ),
      ],
      allowedMentions: {
        parse: [],
        users: conversation.claimedByUserId
          ? [conversation.claimedByUserId]
          : [],
      },
    });
    return reviewMessage.id;
  } finally {
    await thread.setLocked(true).catch((error) => {
      logger.warn(
        { err: error, threadId: thread.id },
        "Could not re-lock mod mail thread after review",
      );
    });
    await thread.setArchived(true).catch((error) => {
      logger.warn(
        { err: error, threadId: thread.id },
        "Could not re-archive mod mail thread after review",
      );
    });
  }
}

async function handleReviewConfirmButton(
  interaction: ButtonInteraction,
  client: Client,
): Promise<void> {
  await interaction.deferUpdate();
  const context = parseReviewContext(
    interaction.customId,
    MODMAIL_REVIEW_CONFIRM_PREFIX,
  );
  const conversation = context
    ? await getModmailByThreadId(context.threadId)
    : undefined;
  if (
    !context ||
    !conversation ||
    conversation.userId !== interaction.user.id ||
    conversation.status !== "closed"
  ) {
    await interaction.editReply({
      embeds: [
        reviewStatusEmbed(
          "Validation impossible",
          "Ce formulaire ne correspond pas à un ticket fermé par le support.",
        ),
      ],
    });
    return;
  }

  if (conversation.reviewMessageId) {
    await interaction.editReply({
      embeds: [
        reviewStatusEmbed(
          "Avis déjà publié",
          "Merci, ton avis a déjà été ajouté au post du ticket.",
        ),
      ],
      components: [],
    });
    return;
  }

  const key = `${context.threadId}:${interaction.user.id}`;
  if (processingReviews.has(key)) {
    await interaction.editReply({
      embeds: [
        reviewStatusEmbed(
          "Publication en cours",
          "Ton avis est en train d’être ajouté au ticket.",
        ),
      ],
    });
    return;
  }

  processingReviews.add(key);
  const draftReview = interaction.message.embeds[0]?.fields.find(
    (field) => field.name === "Ton avis",
  )?.value;
  if (!draftReview) {
    processingReviews.delete(key);
    await interaction.editReply({
      embeds: [
        reviewStatusEmbed(
          "Avis introuvable",
          "Rouvre le formulaire depuis le message de demande d’avis.",
        ),
      ],
    });
    return;
  }

  try {
    let currentConversation = conversation;
    if (currentConversation.reviewRating === null) {
      await saveModmailReview(
        context.threadId,
        interaction.user.id,
        context.rating,
        draftReview,
      );
      currentConversation =
        (await getModmailByThreadId(context.threadId)) ?? currentConversation;
    }

    if (
      currentConversation.reviewRating === null ||
      currentConversation.reviewText === null
    ) {
      throw new Error("The review could not be saved.");
    }

    const user = await client.users.fetch(currentConversation.userId);
    let reviewMessageId = currentConversation.reviewMessageId;
    if (!reviewMessageId) {
      reviewMessageId = await publishModmailReview(
        client,
        currentConversation,
        user,
        currentConversation.reviewRating,
        currentConversation.reviewText,
      );
      await setModmailReviewMessageId(context.threadId, reviewMessageId);
    }

    const dm = await user.createDM();
    const originalPrompt = await dm.messages
      .fetch(context.promptMessageId)
      .catch(() => null);
    await originalPrompt
      ?.edit({
        embeds: [
          reviewStatusEmbed(
            "Merci pour ton avis",
            "Ton retour a été ajouté au post de ton ticket.",
          ),
        ],
        components: [],
      })
      .catch(() => undefined);

    await interaction.editReply({
      embeds: [
        reviewStatusEmbed(
          "Avis publié",
          "Merci d’avoir partagé ton expérience. Ton avis apparaît maintenant dans le ticket.",
        ),
      ],
      components: [],
    });
  } catch (error) {
    logger.error(
      { err: error, threadId: context.threadId, userId: interaction.user.id },
      "Could not publish mod mail review",
    );
    await interaction.editReply({
      embeds: [
        reviewPreviewEmbed(
          conversation.reviewRating ?? context.rating,
          conversation.reviewText ?? draftReview,
        ).setFooter({
          text: "Publication impossible pour le moment • Réessaie en validant à nouveau",
        }),
      ],
      components: reviewPreviewComponents(context),
    }).catch(() => undefined);
  } finally {
    processingReviews.delete(key);
  }
}

export function isModmailButton(customId: string): boolean {
  return (
    customId === MODMAIL_CONFIRM_ID ||
    customId === MODMAIL_CANCEL_ID ||
    customId.startsWith(MODMAIL_REVIEW_RATING_PREFIX) ||
    customId.startsWith(MODMAIL_REVIEW_CONFIRM_PREFIX) ||
    customId.startsWith(MODMAIL_REVIEW_EDIT_PREFIX) ||
    isSupportButton(customId)
  );
}

export async function handleModmailButton(
  interaction: ButtonInteraction,
  client: Client,
): Promise<void> {
  if (interaction.customId.startsWith(MODMAIL_REVIEW_RATING_PREFIX)) {
    await handleReviewRatingButton(interaction);
    return;
  }
  if (interaction.customId.startsWith(MODMAIL_REVIEW_CONFIRM_PREFIX)) {
    await handleReviewConfirmButton(interaction, client);
    return;
  }
  if (interaction.customId.startsWith(MODMAIL_REVIEW_EDIT_PREFIX)) {
    await handleReviewEditButton(interaction);
    return;
  }

  if (
    interaction.customId === MODMAIL_CONFIRM_ID ||
    interaction.customId === MODMAIL_CANCEL_ID
  ) {
    if (interaction.customId === MODMAIL_CANCEL_ID) {
      pendingConfirmations.delete(interaction.user.id);
      await interaction.update({
        embeds: [statusEmbed("Demande annulée", "Aucun message n'a été envoyé au support.")],
        components: [],
      });
      return;
    }

    await handleConfirmationButton(interaction, client);
    return;
  }

  await handleSupportButton(interaction, client);
}

export function isModmailModal(customId: string): boolean {
  return (
    customId === MODMAIL_REPLY_MODAL_ID ||
    customId.startsWith(MODMAIL_REVIEW_MODAL_PREFIX)
  );
}

export async function handleModmailModal(
  interaction: ModalSubmitInteraction,
  client: Client,
): Promise<void> {
  if (interaction.customId.startsWith(MODMAIL_REVIEW_MODAL_PREFIX)) {
    await handleReviewModal(interaction);
    return;
  }

  if (
    !interaction.guild ||
    !interaction.channel?.isThread() ||
    interaction.channel.parentId !== MODMAIL_FORUM_CHANNEL_ID
  ) {
    await interaction.reply({
      embeds: [
        statusEmbed(
          "Action indisponible",
          "Cette action doit être utilisée dans un ticket du support.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (!(await supportMember(interaction))) {
    await interaction.reply({
      embeds: [
        statusEmbed(
          "Accès refusé",
          "Seuls les membres du support peuvent répondre à ce ticket.",
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  const thread = interaction.channel;
  const conversation = await getModmailByThreadId(thread.id);
  if (!conversation || conversation.status === "closed") {
    await interaction.reply({
      embeds: [
        statusEmbed("Ticket fermé", "Ce ticket n'accepte plus de réponse."),
      ],
      ephemeral: true,
    });
    return;
  }

  const content = interaction.fields.getTextInputValue("reply-content").trim();
  const moderator = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);
  const moderatorName = moderator?.displayName ?? interaction.user.username;
  const user = await client.users.fetch(conversation.userId);

  await user.send({
    embeds: [supportReplyEmbed(content, moderatorName)],
    allowedMentions: { parse: [] },
  });
  await thread.send({
    embeds: [supportReplyEmbed(content, moderatorName)],
    allowedMentions: { parse: [] },
  });

  await interaction.reply({
    embeds: [
      statusEmbed(
        "Réponse envoyée",
        "Le message a été envoyé à l'utilisateur et ajouté au ticket.",
      ),
    ],
    ephemeral: true,
  });
}

export async function handleModmailMessage(
  message: Message,
  client: Client,
): Promise<boolean> {
  if (message.author.bot) {
    return false;
  }

  if (message.channel.isDMBased()) {
    await handleDirectMessage(message, client);
    return true;
  }

  if (isModmailThread(message)) {
    await handleSupportMessage(message, client);
    return true;
  }

  return false;
}