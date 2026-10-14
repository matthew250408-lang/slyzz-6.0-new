import { EmbedBuilder } from "discord.js";

export type CustomEmbedInput = {
  title: string | null;
  description: string | null;
  color: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  footer: string | null;
  footerIconUrl: string | null;
  fieldsJson: string | null;
};

type CustomField = {
  nom: string;
  contenu: string;
  inline?: boolean;
};

const DEFAULT_EMBED_COLOR = 0xf2b2a8;
const MAX_EMBED_CHARACTERS = 6000;
const MAX_EMBED_FIELDS = 25;

function parseColor(value: string | null): number {
  if (!value?.trim()) {
    return DEFAULT_EMBED_COLOR;
  }

  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) {
    throw new Error("La couleur doit être au format hexadécimal, par exemple #5865F2.");
  }

  return Number.parseInt(match[1], 16);
}

function parseImageUrl(value: string | null, label: string): string | null {
  if (!value?.trim()) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`L’URL de ${label} est invalide.`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`L’URL de ${label} doit commencer par http:// ou https://.`);
  }

  return url.toString();
}

function parseFields(value: string | null): CustomField[] {
  if (!value?.trim()) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      'Les champs doivent être un tableau JSON, par exemple [{"nom":"Règles","contenu":"Respecte le règlement","inline":true}].',
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Les champs doivent être un tableau JSON.");
  }

  if (parsed.length > MAX_EMBED_FIELDS) {
    throw new Error(`Un embed peut contenir au maximum ${MAX_EMBED_FIELDS} champs.`);
  }

  return parsed.map((field: unknown, index: number) => {
    if (!field || typeof field !== "object" || Array.isArray(field)) {
      throw new Error(`Le champ ${index + 1} doit être un objet JSON.`);
    }

    const candidate = field as Record<string, unknown>;
    const nom =
      typeof candidate.nom === "string" ? candidate.nom.trim() : "";
    const contenu =
      typeof candidate.contenu === "string" ? candidate.contenu.trim() : "";

    if (!nom || !contenu) {
      throw new Error(
        `Le champ ${index + 1} doit contenir un « nom » et un « contenu » non vides.`,
      );
    }
    if (nom.length > 256) {
      throw new Error(`Le nom du champ ${index + 1} dépasse 256 caractères.`);
    }
    if (contenu.length > 1024) {
      throw new Error(`Le contenu du champ ${index + 1} dépasse 1 024 caractères.`);
    }
    if (candidate.inline !== undefined && typeof candidate.inline !== "boolean") {
      throw new Error(
        `La valeur « inline » du champ ${index + 1} doit être true ou false.`,
      );
    }

    return {
      nom,
      contenu,
      ...(candidate.inline === undefined ? {} : { inline: candidate.inline }),
    };
  });
}

export function createCustomEmbed(input: CustomEmbedInput): EmbedBuilder {
  const title = input.title?.trim() || null;
  const description = input.description?.trim() || null;
  const footer = input.footer?.trim() || null;
  const imageUrl = parseImageUrl(input.imageUrl, "l’image");
  const thumbnailUrl = parseImageUrl(input.thumbnailUrl, "la miniature");
  const footerIconUrl = parseImageUrl(input.footerIconUrl, "l’icône du footer");
  const fields = parseFields(input.fieldsJson);

  if (title && title.length > 256) {
    throw new Error("Le titre ne peut pas dépasser 256 caractères.");
  }
  if (description && description.length > 4096) {
    throw new Error("La description ne peut pas dépasser 4 096 caractères.");
  }
  if (footer && footer.length > 2048) {
    throw new Error("Le footer ne peut pas dépasser 2 048 caractères.");
  }
  if (
    !title &&
    !description &&
    !footer &&
    !imageUrl &&
    !thumbnailUrl &&
    !footerIconUrl &&
    fields.length === 0
  ) {
    throw new Error("Ajoute au moins un élément à l’embed avant de l’envoyer.");
  }

  const totalCharacters =
    (title?.length ?? 0) +
    (description?.length ?? 0) +
    (footer?.length ?? 0) +
    fields.reduce((total, field) => total + field.nom.length + field.contenu.length, 0);
  if (totalCharacters > MAX_EMBED_CHARACTERS) {
    throw new Error(
      `Le contenu de l’embed dépasse la limite de ${MAX_EMBED_CHARACTERS} caractères de Discord.`,
    );
  }

  const embed = new EmbedBuilder().setColor(parseColor(input.color));
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (imageUrl) embed.setImage(imageUrl);
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  if (footer || footerIconUrl) {
    embed.setFooter({
      text: footer || "\u200b",
      ...(footerIconUrl ? { iconURL: footerIconUrl } : {}),
    });
  }
  if (fields.length > 0) {
    embed.addFields(
      fields.map((field) => ({
        name: field.nom,
        value: field.contenu,
        inline: field.inline ?? false,
      })),
    );
  }

  return embed;
}
