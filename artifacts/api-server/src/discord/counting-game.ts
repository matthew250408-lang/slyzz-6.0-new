import {
  EmbedBuilder,
  PermissionFlagsBits,
  type Message,
} from "discord.js";
import { logger } from "../lib/logger";
import {
  acceptCountingAttempt,
  resetCountingGame,
  rollbackCountingAttempt,
} from "./counting-game-store";

export const COUNTING_GAME_CHANNEL_ID = "1560372113846698076";
export const COUNTING_GAME_RESET_COMMAND = "!resetinfini";
const COUNTING_EMBED_COLOR = 0xf2b2a8;

const queuedMessages = new Map<string, Promise<unknown>>();

async function runInChannelOrder<T>(
  channelId: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = queuedMessages.get(channelId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(action);
  queuedMessages.set(channelId, current);

  try {
    return await current;
  } finally {
    if (queuedMessages.get(channelId) === current) {
      queuedMessages.delete(channelId);
    }
  }
}

function countingEmbed(message: Message, count: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COUNTING_EMBED_COLOR)
    .setAuthor({
      name:
        message.member?.displayName ??
        message.author.globalName ??
        message.author.username,
      iconURL: message.author.displayAvatarURL(),
    })
    .setDescription(`**${count}**`);
}

export async function handleCountingGameResetCommand(
  message: Message,
): Promise<boolean> {
  const guild = message.guild;
  if (
    message.author.bot ||
    !guild ||
    message.content.trim().toLowerCase() !== COUNTING_GAME_RESET_COMMAND
  ) {
    return false;
  }

  const member =
    message.member ??
    (await guild.members.fetch(message.author.id).catch(() => null));
  if (
    guild.ownerId !== message.author.id &&
    !member?.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    await message
      .reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COUNTING_EMBED_COLOR)
            .setTitle("Accès refusé")
            .setDescription(
              "Seuls les administrateurs du serveur et son propriétaire peuvent réinitialiser le compteur.",
            ),
        ],
        allowedMentions: { parse: [], repliedUser: false },
      })
      .catch((error: unknown) => {
        logger.warn(
          { err: error, channelId: message.channelId },
          "Could not reply to an unauthorized counting reset",
        );
      });
    return true;
  }

  const gameChannel = await guild.channels
    .fetch(COUNTING_GAME_CHANNEL_ID)
    .catch(() => null);
  if (!gameChannel?.isTextBased() || gameChannel.isDMBased()) {
    await message
      .reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COUNTING_EMBED_COLOR)
            .setTitle("Jeu de comptage indisponible")
            .setDescription(
              "Le salon de comptage n'a pas été trouvé sur ce serveur.",
            ),
        ],
        allowedMentions: { parse: [], repliedUser: false },
      })
      .catch(() => undefined);
    return true;
  }

  const botMember = guild.members.me;
  if (
    !botMember?.permissionsIn(gameChannel).has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ])
  ) {
    await message
      .reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COUNTING_EMBED_COLOR)
            .setTitle("Réinitialisation impossible")
            .setDescription(
              "Biscotto doit pouvoir voir le salon de comptage, y envoyer des messages et des embeds.",
            ),
        ],
        allowedMentions: { parse: [], repliedUser: false },
      })
      .catch(() => undefined);
    return true;
  }

  let resetStored = false;
  try {
    await runInChannelOrder(COUNTING_GAME_CHANNEL_ID, async () => {
      await resetCountingGame(COUNTING_GAME_CHANNEL_ID);
      resetStored = true;
      await gameChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COUNTING_EMBED_COLOR)
            .setTitle("Compteur remis à zéro")
            .setDescription("Le prochain nombre accepté est **1**.")
            .setFooter({
              text: `Réinitialisé par ${member?.displayName ?? message.author.username}`,
            }),
        ],
        allowedMentions: { parse: [] },
      });
    });
  } catch (error) {
    logger.error(
      { err: error, channelId: COUNTING_GAME_CHANNEL_ID, resetStored },
      "Could not complete the counting game reset command",
    );
    await message
      .reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COUNTING_EMBED_COLOR)
            .setTitle(
              resetStored
                ? "Compteur remis à zéro"
                : "Réinitialisation impossible",
            )
            .setDescription(
              resetStored
                ? "Le compteur est à zéro, mais la confirmation n'a pas pu être publiée dans le salon de comptage."
                : "Le compteur n'a pas pu être réinitialisé. Réessaie dans un instant.",
            ),
        ],
        allowedMentions: { parse: [], repliedUser: false },
      })
      .catch(() => undefined);
    return true;
  }

  await message.delete().catch((error: unknown) => {
    logger.warn(
      { err: error, channelId: message.channelId },
      "Could not delete the counting reset command",
    );
  });
  return true;
}

export async function handleCountingGameMessage(
  message: Message,
): Promise<boolean> {
  const guild = message.guild;
  if (message.channelId !== COUNTING_GAME_CHANNEL_ID || !guild) {
    return false;
  }

  if (message.author.bot) {
    return true;
  }

  return runInChannelOrder(message.channelId, async () => {
    const submitted = message.content.trim();
    if (!/^\d+$/.test(submitted)) {
      return true;
    }

    const channel = message.channel;
    if (!channel.isTextBased() || channel.isDMBased()) {
      return true;
    }

    const botMember = guild.members.me;
    const requiredPermissions = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ManageMessages,
    ];
    if (!botMember?.permissionsIn(channel).has(requiredPermissions)) {
      logger.error(
        { channelId: message.channelId },
        "Counting game requires View Channel, Send Messages, Embed Links, and Manage Messages",
      );
      return true;
    }

    const submittedCount = BigInt(submitted).toString();
    const result = await acceptCountingAttempt(
      message.channelId,
      message.author.id,
      submittedCount,
    );

    if (!result.accepted) {
      await message.delete().catch((error: unknown) => {
        logger.warn(
          { err: error, channelId: message.channelId, userId: message.author.id },
          "Could not delete a rejected counting attempt",
        );
      });
      return true;
    }

    let publishedMessage: Message | undefined;
    try {
      publishedMessage = await channel.send({
        embeds: [countingEmbed(message, result.count)],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      const rolledBack = await rollbackCountingAttempt(
        message.channelId,
        result.count,
        message.author.id,
        result.previousCount,
        result.previousLastUserId,
      ).catch((rollbackError: unknown) => {
        logger.error(
          { err: rollbackError, channelId: message.channelId },
          "Could not roll back a count after embed publishing failed",
        );
        return false;
      });
      logger.error(
        { err: error, channelId: message.channelId, rolledBack },
        "Could not publish a counting embed",
      );
      return true;
    }

    try {
      await message.delete();
    } catch (error) {
      await publishedMessage.delete().catch((deleteError: unknown) => {
        logger.warn(
          { err: deleteError, channelId: message.channelId },
          "Could not remove a counting embed after source deletion failed",
        );
      });
      const rolledBack = await rollbackCountingAttempt(
        message.channelId,
        result.count,
        message.author.id,
        result.previousCount,
        result.previousLastUserId,
      ).catch((rollbackError: unknown) => {
        logger.error(
          { err: rollbackError, channelId: message.channelId },
          "Could not roll back a count after source deletion failed",
        );
        return false;
      });
      logger.warn(
        { err: error, channelId: message.channelId, rolledBack },
        "Could not delete a counting attempt after publishing its embed",
      );
    }

    return true;
  });
}
