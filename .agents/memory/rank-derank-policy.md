---
name: Rank and derank policy
description: User-specified access role and custom emojis for Biscotto rank/derank commands.
---

The user specified one `/rank-derank` command with a choice between `rank` and `derank`, plus a `role` option that selects the role to add/remove. It is available to members with role `1429494599730335765`, server administrators, and the server owner. Announcements must be embeds posted in channel `1542655357728456855`; the message above the embed mentions the affected member and notification role `1429508546550038648`, while the embed includes the selected role in its action text. The footer identifies the command author. Rank and derank use Markdown H2 headings, the user's French copy, and quoted member/reason lines with `<:utilisateur:1558391260375556097>` and `<:raison:1558391410498084925>`; use `<:rank:1558389911625662544>` for rank and `<:derank:1558389778406440991>` for derank. Add `:okay:` as a reaction to the announcement message; never place it in the embed title or heading.

The action heading should be visually larger than the body text, without visible `#` characters, and followed by a clear gap before the member field.

**Why:** Discord fixes the font size of an embed's title property, so a Markdown heading in the description is the native way to make the action heading larger.

**Why:** The user explicitly clarified that `:okay:` belongs on the announcement as a reaction, not in its title.

**How to apply:** preserve the access gate, configurable action role, fixed notification role and channel, mention behavior, author footer, hierarchy checks, emoji IDs, French copy, and heading/spacing presentation when extending this command.
