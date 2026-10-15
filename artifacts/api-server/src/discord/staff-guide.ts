import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

export const STAFF_GUIDE_PREVIOUS_BUTTON_ID = "staff-guide:previous";
export const STAFF_GUIDE_NEXT_BUTTON_ID = "staff-guide:next";
export const STAFF_GUIDE_PRIVATE_PREVIOUS_BUTTON_ID =
  "staff-guide:private:previous";
export const STAFF_GUIDE_PRIVATE_NEXT_BUTTON_ID = "staff-guide:private:next";

export const STAFF_GUIDE_PAGES = [
  {
    title: "📘・Guide Staff Slyzz",
    description: [
      "Bienvenue dans l'équipe de Slyzz !",
      "",
      "Ce guide regroupe les règles et les procédures essentielles pour assurer une bonne modération du serveur.",
      "",
      "Merci de le lire attentivement et de respecter les consignes présentées.",
    ].join("\n"),
  },
  {
    title: "📋・Règles générales",
    description: [
      "Tous les membres du staff doivent :",
      "",
      "- Respecter les membres et l'équipe.",
      "- Rester calmes et professionnels.",
      "- Être impartiaux dans leurs décisions.",
      "- Garder les informations internes confidentielles.",
      "- Utiliser leurs permissions correctement.",
    ].join("\n"),
  },
  {
    title: "🛡️・Rôles et responsabilités",
    description: [
      "**Modérateurs :**",
      "- Faire respecter le règlement.",
      "- Traiter les signalements.",
      "- Intervenir en cas d'infraction.",
      "- Transmettre les problèmes importants.",
      "",
      "**Administrateurs :**",
      "- Superviser la modération.",
      "- Gérer les situations complexes.",
      "- Accompagner les modérateurs.",
      "- Veiller au bon fonctionnement du serveur.",
    ].join("\n"),
  },
  {
    title: "⚖️・Procédures de modération",
    description: [
      "Avant toute sanction :",
      "",
      "1. Vérifiez les faits.",
      "2. Identifiez la règle enfreinte.",
      "3. Évaluez la gravité de la situation.",
      "4. Appliquez une sanction adaptée.",
      "5. Conservez une preuve si nécessaire.",
      "",
      "En cas de doute, demandez conseil à un administrateur.",
    ].join("\n"),
  },
  {
    title: "🔨・Les sanctions",
    description: [
      "- **Avertissement :** rappeler une règle.",
      "- **Timeout :** suspendre temporairement la participation d'un membre.",
      "- **Expulsion :** retirer un membre du serveur sans bannissement.",
      "- **Bannissement :** interdire l'accès au serveur.",
      "",
      "Toute sanction doit être justifiée et proportionnée. Les infractions graves peuvent nécessiter une sanction immédiate plus ferme.",
    ].join("\n"),
  },
  {
    title: "🎫・Gestion des tickets",
    description: [
      "Lorsqu'un ticket est ouvert :",
      "",
      "- Accueillez le membre poliment.",
      "- Prenez connaissance de sa demande.",
      "- Posez des questions si nécessaire.",
      "- Apportez une réponse claire.",
      "- Demandez de l'aide si besoin.",
      "- Fermez le ticket lorsque la demande est résolue.",
    ].join("\n"),
  },
  {
    title: "📊・Activité du staff",
    description: [
      "Chaque membre doit participer au bon fonctionnement du serveur selon les attentes définies par le haut staff.",
      "",
      "- Restez actif dans la mesure de vos disponibilités.",
      "- Répondez aux sollicitations importantes.",
      "- Prévenez en cas d'absence.",
      "- Participez aux tâches de modération.",
      "- Acceptez les remarques constructives.",
      "",
      "La qualité du travail compte autant que la quantité.",
    ].join("\n"),
  },
  {
    title: "🤝・Communication interne",
    description: [
      "Une bonne communication est essentielle au fonctionnement de l'équipe.",
      "",
      "- Utilisez les salons prévus pour le staff.",
      "- Transmettez les informations importantes.",
      "- Restez respectueux lors des désaccords.",
      "- Évitez les conflits publics.",
      "- Signalez les problèmes aux responsables concernés.",
      "",
      "L'entraide permet d'assurer une modération plus efficace.",
    ].join("\n"),
  },
  {
    title: "🔒・Discipline interne",
    description: [
      "Tout membre du staff est responsable de son comportement et de l'utilisation de ses permissions.",
      "",
      "Les abus de pouvoir, les sanctions personnelles et les fuites d'informations confidentielles peuvent entraîner un derank instantanée.",
    ].join("\n"),
  },
  {
    title: "✅・Conclusion",
    description: [
      "Chaque membre du staff contribue à la qualité et à la réputation de Slyzz.",
      "",
      "Restez respectueux, impartiaux et responsables dans chacune de vos interventions.",
      "",
      "En cas de doute, privilégiez la communication et demandez de l'aide.",
      "",
      "Merci pour votre investissement et votre engagement au sein du staff Slyzz !",
    ].join("\n"),
  },
] satisfies Array<{ title: string; description: string }>;

export function staffGuideEmbed(pageIndex: number): EmbedBuilder {
  const page = STAFF_GUIDE_PAGES[pageIndex];
  if (!page) {
    throw new RangeError(`Invalid staff guide page index: ${pageIndex}`);
  }

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(page.title)
    .setDescription(page.description)
    .setFooter({
      text: `Slyzz・Guide Staff • Page ${pageIndex + 1}/${STAFF_GUIDE_PAGES.length}`,
    });
}

export function staffGuideComponents(
  pageIndex: number,
  privateView = false,
) {
  const previousButtonId = privateView
    ? STAFF_GUIDE_PRIVATE_PREVIOUS_BUTTON_ID
    : STAFF_GUIDE_PREVIOUS_BUTTON_ID;
  const nextButtonId = privateView
    ? STAFF_GUIDE_PRIVATE_NEXT_BUTTON_ID
    : STAFF_GUIDE_NEXT_BUTTON_ID;

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(previousButtonId)
        .setLabel("Précédent")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pageIndex === 0),
      new ButtonBuilder()
        .setCustomId(nextButtonId)
        .setLabel("Suivant")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === STAFF_GUIDE_PAGES.length - 1),
    ),
  ];
}

export function isStaffGuideButton(customId: string): boolean {
  return (
    customId === STAFF_GUIDE_PREVIOUS_BUTTON_ID ||
    customId === STAFF_GUIDE_NEXT_BUTTON_ID ||
    customId === STAFF_GUIDE_PRIVATE_PREVIOUS_BUTTON_ID ||
    customId === STAFF_GUIDE_PRIVATE_NEXT_BUTTON_ID
  );
}

export function isPrivateStaffGuideButton(customId: string): boolean {
  return (
    customId === STAFF_GUIDE_PRIVATE_PREVIOUS_BUTTON_ID ||
    customId === STAFF_GUIDE_PRIVATE_NEXT_BUTTON_ID
  );
}

export function staffGuideButtonDirection(
  customId: string,
): -1 | 1 | null {
  if (
    customId === STAFF_GUIDE_PREVIOUS_BUTTON_ID ||
    customId === STAFF_GUIDE_PRIVATE_PREVIOUS_BUTTON_ID
  ) {
    return -1;
  }
  if (
    customId === STAFF_GUIDE_NEXT_BUTTON_ID ||
    customId === STAFF_GUIDE_PRIVATE_NEXT_BUTTON_ID
  ) {
    return 1;
  }
  return null;
}

export function staffGuidePageIndex(footerText: string | null | undefined) {
  const match = footerText?.match(
    /Slyzz・Guide Staff • Page (\d+)\/(\d+)/,
  );
  if (!match || Number(match[2]) !== STAFF_GUIDE_PAGES.length) {
    return null;
  }

  const pageIndex = Number(match[1]) - 1;
  return pageIndex >= 0 && pageIndex < STAFF_GUIDE_PAGES.length
    ? pageIndex
    : null;
}
