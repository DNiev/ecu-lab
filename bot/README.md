# ECU Lab Dyno: the `/dyno` Discord command

Runs a full-throttle dyno pull of one of ECU Lab's factory engines from the testers'
Discord server, optionally with bolt-ons or a different fuel, on the engine's factory
tune. The reply shows the peaks, how they moved against stock, the pull log's worst
warnings, and a chart.

It runs the sim on `main`, not the last release: the testers are trying what is coming.
Every reply's footer names the commit (`main @ abc1234 (unreleased)`), so quote it in bug
reports.

The design is in `docs/superpowers/specs/2026-10-28-discord-dyno-bot-design.md`.

## How it fits together

- `api/interactions.js` is the one URL Discord calls. It wires the runtime into
  `lib/handler.js`, which checks Discord's signature, answers at once with a deferred reply,
  then runs the pulls, draws the chart and edits that reply.
- `lib/` is all the logic. It imports nothing from `bot/node_modules`, so the root
  `npm test`, `npm run lint` and `npm run typecheck` cover it.
- `render.js` turns the SVG chart into a PNG with resvg and the bundled Roboto font.
- The pull is `buildRig` from `src/sim/rig.js`: the same assembly the app uses.

## Setting it up (the owner's steps)

None of these involve putting a secret in the repo.

1. **Discord.** At <https://discord.com/developers/applications>, create an application
   named "ECU Lab Dyno". Under **Installation**, give it the `applications.commands` scope
   only, with no bot permissions: it never reads messages. Use the install link to add it
   to the server.
2. **Vercel.** Create a Hobby account and import `DNiev/ecu-lab`, letting Vercel's GitHub
   app see that one repository only. In the project settings:
   - **Root Directory:** `bot`, with "Include files outside the Root Directory" left on
   - **Environment variable:** `DISCORD_PUBLIC_KEY` = the application's public key
     (Discord's **General Information** page). It's public by design.
3. **The endpoint.** After the first deploy, paste
   `https://<your-project>.vercel.app/api/interactions` into the application's
   **Interactions Endpoint URL**. Discord sends a signed check when you save. If it
   refuses, the function log in Vercel says why.
4. **Register the command**, from a shell on your own machine. The bot token is on the
   application's **Bot** page; reset it there if you ever think it has leaked.

   ```bash
   DISCORD_APP_ID=… DISCORD_GUILD_ID=… DISCORD_BOT_TOKEN=… node bot/scripts/register.js
   ```

   Re-run it whenever a preset or fuel is added.
5. **Who can use it.** In Discord, **Server Settings → Integrations → ECU Lab Dyno**:
   limit `/dyno` to the testers' channel or role.

## Deploys

Vercel deploys from `main` only. `scripts/should-build.sh` skips every other branch and
pull request, forks included, and skips `main` unless the bot, `src/sim`,
`src/ui/tokens.js` or `scripts/discord-notify.js` changed.

## Working on it

```bash
cd bot && npm ci
node scripts/preview.js /tmp/dyno-preview   # every preset's chart, as real PNGs
```

The logic's tests are in `tests/bot/` and run with the rest of the suite.
