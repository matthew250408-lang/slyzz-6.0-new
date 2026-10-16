# Slyzz 6.0 — Bot Discord

Bot Discord configurable pour gérer le recrutement, les conversations de modmail et les annonces du staff.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional secret: `DISCORD_BOT_TOKEN` (or `DISCORD_TOKEN`) — enables the Discord bot

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/discord/bot.ts` — slash commands and Discord interaction handlers
- `artifacts/api-server/src/discord/modmail.ts` — member support conversations and moderator actions
- `artifacts/api-server/src/discord/store.ts` — persisted registration configuration
- `lib/db/src/schema/` — registration and modmail tables
- `lib/db/src/schema/maintenance-message.ts` — saved message IDs for persistent status and maintenance embeds

## Architecture decisions

- The API server keeps running if the Discord token is absent; bot startup is disabled until one is configured.
- Registration settings and active modmail conversation state are persisted in PostgreSQL.
- Setup access is checked in bot interactions; members can still use the public registration flow.

## Product

- `/status` creates or updates one persistent embed in the command channel and hides its temporary command response. It refreshes automatically when maintenance starts, ends, or expires.
- The `!guidestaff` message command is restricted to user IDs `1140296215469240401` and `1487882100613971979`. It posts a cover and pings role `1429508546550038648` above the embed; the bot deletes the invoking message and needs Manage Messages in the channel. `Consulter le guide` opens a private 10-page copy beginning with the sommaire. Private navigation uses `Précédent`/`Suivant`, with `Accueil` replacing `Suivant` on the final page and returning to the sommaire.
- The counting game runs in channel `1560372113846698076`. Members count upward from 1; each valid number is replaced with an embed showing the member and count. The same member cannot count twice in a row, and incorrect attempts are deleted without changing the persistent count. `!resetinfini` resets the count to zero and is restricted to server administrators and the owner.
- Support maintenance publishes or edits an embed in channel `1429467909545005128`; staff-absence maintenance does the same in channel `1559248976694353960`. Active notices show the reason and expected end time or manual duration, are edited when maintenance ends, then deleted one minute after the end time.

- Les administrateurs configurent le recrutement depuis un panneau privé avec aperçu; les candidats voient un embed de recrutement mis en forme avec l’identité du serveur, les étapes, les thèmes du formulaire et son état.
- Le formulaire propose quatre questions staff par défaut, reste personnalisable et accepte jusqu’à cinq questions; les anciennes configurations sont conservées et les anciens textes par défaut sont actualisés.
- Les candidats envoient leur candidature via un formulaire Discord.
- Members can open support conversations through modmail; moderators can claim, reply, and close conversations. On closure, the member receives a private five-star review flow; a validated review is posted in the ticket with the member, rating, and assigned moderator, then the thread is locked and archived again.
- `/maintenance` is restricted to one authorized member. It can pause support, recruitment, staff absence announcements, or track a Slyzz website maintenance status, or publish a notice without disabling services. The website status is informational only; this project does not control the website itself. A reason is required; the Brussels end date/time is optional, with manual reopening when omitted. `/status` is limited to the configured status roles and authorized member.
- Authorized users can publish custom embeds with `/message`; `/info-bot` displays the bot version, developer, and last-modified date; `/info-serveur` summarizes the current server.
- `/absence-staff date_debut date_fin raison` announces the invoking staff member's absence in channel `1559248976694353960`, mentioning them. Only members with role `1429508546550038648` can use it. The embed starts as `En cours...`; its creator alone can click `Terminer maintenant`, which marks it `Terminé` and triggers a DM.
- `/rank-derank` lets an authorized user choose `rank` or `derank`, changes the configured role, and posts an announcement embed in the configured announcement channel.

### Custom embeds

Use `/message` with any combination of `titre`, `description`, `couleur`, `image`, `miniature`, `footer`, `icone-footer`, and `champs`. If `couleur` is omitted, the embed uses `#f2b2a8`. Image, thumbnail, and footer-icon values must be public HTTP(S) URLs.

Example: `/message titre:Bienvenue description:Bienvenue sur le serveur ! couleur:#5865F2`

`champs` is a JSON array using French keys, for example:

```json
[{"nom":"Règles","contenu":"Respecte le règlement","inline":true}]
```

The command is limited to the primary administrators and users authorized for that server with `/setup-permission`. `/info-bot` is public and reports version `6.0`, developer `<@1140296215469240401>`, and the last-modified date.

### Rank and derank

`/rank-derank` takes an `action` choice (`rank` or `derank`), a member, a `role` to add/remove, and a reason. It also adds/removes role `1429508546550038648`. It posts the rank/derank embed in channel `1542655357728456855`; the message above the embed mentions the affected member and the notification role `1429508546550038648`, while the embed includes the selected role in its action copy. The footer identifies the command author and shows their avatar. Rank and derank use Markdown H2 headings, the specified French copy, and quoted member/reason lines with `<:utilisateur:1558391260375556097>` and `<:raison:1558391410498084925>`; use `<:rank:1558389911625662544>` for rank and `<:derank:1558389778406440991>` for derank. Add `:okay:` as a reaction to the announcement message, not in the embed title. Access is limited to members with role `1429494599730335765`, server administrators, and the server owner. Biscotto needs **Manage Roles**, permission to send embeds and mention the notification role in the announcement channel, and a role hierarchy above every role being modified and the member.

### Recrutement et absences

- `/setup-inscription` conserve son nom pour compatibilité, mais configure le formulaire de recrutement. Il permet de personnaliser le message, le titre, le bouton, jusqu'à cinq questions et le salon qui reçoit les candidatures. Les questions de motivation, d'expérience, de disponibilité et de gestion des conflits sont proposées avec les questions personnalisées.
- `/setup-permission` reste réservé aux administrateurs principaux. Son panneau privé permet d'ajouter ou retirer des membres avec des sélecteurs, ou de remplacer la liste complète par IDs; les membres autorisés ne peuvent pas modifier ces accès.
- `/absence-staff date_debut date_fin raison` publie dans le salon `1559248976694353960` un embed rose qui mentionne le membre qui lance la commande et affiche son rôle le plus élevé, les dates au format `JJ/MM/AAAA`, la raison et le statut `En cours...`.
- Seul l'auteur de l'absence peut utiliser le bouton `Terminer maintenant`. Le bot passe le statut à `Terminé`, désactive le bouton et lui envoie un DM. Si ses paramètres Discord bloquent les DM, le statut est tout de même mis à jour et le bot l'indique.
- `/info-serveur` affiche le propriétaire, le nombre de membres, les dates et les principaux compteurs du serveur.

## User preferences

_Aucune préférence particulière indiquée._

## Gotchas

- Discord bot actions require `DISCORD_BOT_TOKEN` or `DISCORD_TOKEN` in Replit Secrets.
- Run `pnpm --filter @workspace/db run push` in development after schema changes.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
