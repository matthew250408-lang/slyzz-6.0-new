import app from "./app";
import { logger } from "./lib/logger";
import { startDiscordBot } from "./discord/bot";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

const discordToken =
  process.env["DISCORD_BOT_TOKEN"] ?? process.env["DISCORD_TOKEN"];
if (!discordToken) {
  logger.warn(
    "DISCORD_BOT_TOKEN is not configured; the HTTP server is running but the Discord bot is disabled.",
  );
} else {
  startDiscordBot(discordToken).catch((error: unknown) => {
    logger.error({ err: error }, "Discord bot failed to start");
  });
}
