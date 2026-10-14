import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Guild,
  type Message,
  type TextChannel,
} from "discord.js";
import { getInscriptionConfig, saveInscriptionConfig } from "./store";
import { registrationEmbed } from "./embeds";
import {
  getActiveMaintenance,
  maintenanceReasonLabel,
} from "./maintenance-store";

const REGISTRATION_BUTTON_ID = "registration:open";

function registrationButton(label: string) {
  return new ButtonBuilder()
    .setCustomId(REGISTRATION_BUTTON_ID)
    .setLabel(label)
    .setStyle(ButtonStyle.Success);
}

export function registrationComponents(
  buttonLabel: string,
  disabled = false,
) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      registrationButton(buttonLabel).setDisabled(disabled),
    ),
  ];
}

export async function syncRegistrationMessage(
  guild: Guild,
  fallbackChannel: TextChannel,
  preferredChannel?: TextChannel,
): Promise<Message> {
  const config = await getInscriptionConfig(guild.id);
  let targetChannel: TextChannel | null = preferredChannel ?? null;

  if (!targetChannel && config.registrationChannelId) {
    const channel = await guild.channels
      .fetch(config.registrationChannelId)
      .catch(() => null);
    if (channel?.isTextBased() && !channel.isDMBased()) {
      targetChannel = channel as TextChannel;
    }
  }

  targetChannel ??= fallbackChannel;

  let existingMessage: Message | null = null;
  if (config.registrationMessageId && config.registrationChannelId) {
    const channel = await guild.channels
      .fetch(config.registrationChannelId)
      .catch(() => null);
    if (channel?.isTextBased() && "messages" in channel) {
      existingMessage = await channel.messages
        .fetch(config.registrationMessageId)
        .catch(() => null);
    }
  }

  const recruitmentMaintenance = await getActiveMaintenance("recrutement");
  const payload = {
    embeds: [
      registrationEmbed(
        config.embedTitle,
        config.messageContent,
        config.buttonLabel,
        config.questions,
        guild,
        Boolean(config.responseChannelId && config.questions.length > 0),
        recruitmentMaintenance
          ? {
              message: recruitmentMaintenance.message,
              reason: maintenanceReasonLabel(recruitmentMaintenance.reason),
              endsAt: recruitmentMaintenance.endsAt,
            }
          : undefined,
      ),
    ],
    components: [
      registrationComponents(
        config.buttonLabel,
        Boolean(recruitmentMaintenance) ||
          !config.responseChannelId ||
          config.questions.length === 0,
      )[0],
    ],
  };

  if (existingMessage) {
    if (existingMessage.channelId !== targetChannel.id) {
      await existingMessage.delete().catch(() => undefined);
      const created = await targetChannel.send(payload);
      await saveInscriptionConfig(guild.id, {
        registrationChannelId: targetChannel.id,
        registrationMessageId: created.id,
      });
      return created;
    }

    try {
      await existingMessage.edit(payload);
      return existingMessage;
    } catch (error) {
      if ((error as { code?: number }).code !== 10008) {
        throw error;
      }

      const created = await targetChannel.send(payload);
      await saveInscriptionConfig(guild.id, {
        registrationChannelId: targetChannel.id,
        registrationMessageId: created.id,
      });
      return created;
    }
  }

  const created = await targetChannel.send(payload);
  await saveInscriptionConfig(guild.id, {
    registrationChannelId: targetChannel.id,
    registrationMessageId: created.id,
  });
  return created;
}

export { REGISTRATION_BUTTON_ID };