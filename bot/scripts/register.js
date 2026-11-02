/**
 * Registers `/dyno` on one Discord server. Run it once after creating the app, and again
 * whenever a preset or fuel is added (Discord keeps its own copy of the choices):
 *
 *   DISCORD_APP_ID=… DISCORD_GUILD_ID=… DISCORD_BOT_TOKEN=… node bot/scripts/register.js
 *
 * The bot token lives only in the shell that runs this. The deployed bot never needs it:
 * replies go through each interaction's own token. A PUT replaces the server's whole
 * command list, so running it twice is harmless.
 */

import { dynoCommand } from '../lib/command.js';

const NEEDED = ['DISCORD_APP_ID', 'DISCORD_GUILD_ID', 'DISCORD_BOT_TOKEN'];
const missing = NEEDED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Set ${missing.join(', ')} in this shell first.`);
  process.exit(1);
}

const { DISCORD_APP_ID, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN } = process.env;
const res = await fetch(`https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/${DISCORD_GUILD_ID}/commands`, {
  method: 'PUT',
  headers: { authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify([dynoCommand()]),
});
if (!res.ok) {
  console.error(`Discord refused the registration (${res.status}): ${await res.text()}`);
  process.exit(1);
}
console.log(`Registered /dyno on server ${DISCORD_GUILD_ID}.`);
