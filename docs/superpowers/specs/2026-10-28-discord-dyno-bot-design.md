# `/dyno` in Discord: a dyno pull from chat

The Discord server is for a small group who test ECU Lab before releases. `/dyno` lets
them run a full-throttle pull of a factory engine from chat, with optional bolt-ons or a
different fuel. It replies with peak power and torque, the difference from stock, the
pull log's warnings and a chart.

The factory tune is never changed. As in the app, parts that the calibration doesn't
know about show up as warnings rather than free power, and that is the point:

> **VQ35HR · Cold Air Intake + Long-Tube Headers · factory tune**
> **261 whp** (+1 vs stock) · **237 lb-ft** (+5)
> ⚠️ MAF trim averaging −10% across 1500–7500 RPM: running rich
> ⚠️ Lean mixture (up to 16.8:1) across 3900–7500 RPM under load
> *[chart: power and torque against RPM, stock dashed underneath]*
> `main @ 27db48c (unreleased) · ECU Lab sim`

Those figures come from the full engine-management pull on `main` as of 27db48c.

## Decisions already made

- **Discord only.** The command is registered for this one server, never globally.
- **Hosted on Vercel's free Hobby plan, in the Node runtime.** One pull takes 75 to
  165 ms of CPU, so Cloudflare Workers' free plan (10 ms per request) cannot run it.
  Vercel runs real Node, the same runtime the tests use.
- **Built from `main`.** The testers are trying what is coming, so the bot runs the sim on
  `main`, not the last release. Vercel's GitHub app deploys it when `main` changes.
  Nothing new is stored in GitHub, and nothing new runs alongside the webhook secrets.
- **The reply is a PNG chart**, drawn as SVG by our code and turned into a PNG by
  `@resvg/resvg-js`.
- **Replies are public in the channel.** Which channels and roles can use `/dyno` is set
  in Discord (Server Settings → Integrations), not in code. There is no rate limiter:
  the users are a known group and Discord's own limits apply.

## The command

```
/dyno engine:<preset> [intake:<bool>] [exhaust:<bool>] [headers:<bool>] [fuel:<choice>]
```

| Option | Kind | Values | When left out |
| --- | --- | --- | --- |
| `engine` | required choice | the 7 presets, `name` as label and `id` as value | — |
| `intake` | optional boolean | | the preset's own `mods.intake` |
| `exhaust` | optional boolean | | the preset's own `mods.exhaust` |
| `headers` | optional boolean | | the preset's own `mods.headers` |
| `fuel` | optional choice | `OCTANE_OPTS` labels: 91, 93, 100, E85 | the preset's own `parts.octaneIdx` |

The choices are generated from `ENGINE_PRESETS` and `OCTANE_OPTS` when the command is
registered, never typed out by hand, so they cannot drift from the sim. `intercooler` is
not offered: every preset that wants one already ships with one, and on a naturally
aspirated engine it does nothing. Flex fuel is left out because it needs an ethanol
percentage, which is one more option than a first version needs.

The command is only a test-group tool, so it has no build of its own beyond the preset. A
saved-calibration option can come once the app can share a calibration (CONTRIBUTING's
feature list).

## Architecture

```
src/sim/rig.js            NEW   the app's dyno pull, as a pure function (shared)
tests/ecuHarness.js       EDIT  makeEngine becomes a thin wrapper over src/sim/rig.js
bot/
  package.json                  own dependencies: @resvg/resvg-js, @vercel/functions
  vercel.json                   function settings and ignoreCommand
  api/interactions.js           the one URL Discord calls: wires the runtime into lib/handler.js
  render.js                     SVG → PNG (resvg, with the bundled font)
  lib/handler.js                the request handler, with its runtime passed in
  lib/verify.js                 Discord request signature check
  lib/dyno.js                   command options → stock pull and modified pull
  lib/chart.js                  pulls → SVG string
  lib/reply.js                  pulls → Discord message body
  lib/command.js                the command definition, built from the sim
  scripts/register.js           registers the command for one server (run by hand)
  scripts/preview.js            renders every preset's chart to PNG files, to look at
  scripts/should-build.sh       Vercel's ignore step: build only when needed
  fonts/Roboto-Regular.ttf      the chart's font, with its licence file
```

`bot/lib/` imports nothing from `bot/node_modules`: only Node built-ins, `src/sim`,
`src/ui/tokens.js` and `scripts/discord-notify.js`. The two files that load the bot's own
dependencies, `api/interactions.js` (`@vercel/functions`) and `render.js` (resvg), sit
outside it and stay a few lines long. That split is what lets the root test suite,
linter and type checker cover all the bot's logic without installing the bot's
dependencies.

### `src/sim/rig.js`: one dyno pull, shared by the tests and the bot

Today the app's full pull is assembled in `EcuLab.jsx` and again in `tests/ecuHarness.js`.
"Full" means the ECU in the loop, true airflow from `computeHardwareVE` for the fitted
parts, fuel from `tankFuel`, and the preset's own calibration. The simpler assembly in
`tests/presets.test.js` passes `veTruth: patch.ve`, which ignores bolt-ons: intake plus
headers on a VQ35HR comes out at 260 → 260 whp. The bot needs the full pull.

`makeEngine`'s body (everything but `runLive` and `at`) moves to `src/sim/rig.js` as
`buildRig(opts)`, with the same options and the same return value (`build`, `derived`,
`cal`, `hw`, `tables`, `veTruth`, `fuel`, `turbine`, `compressor`, `pull`, `liveCfg`). It is
exported from `src/sim/index.js` and gets full JSDoc, as the rest of `src/sim/` has.
`tests/ecuHarness.js` keeps `makeEngine` as `export const makeEngine = buildRig`, so no
test changes.

The move is pure: it adds no physics and changes no numbers. That is shown by
`tests/fingerprint.sha256` staying byte-identical and the whole suite passing unchanged.
`EcuLab.jsx` is not changed in this work. It keeps its own `useMemo` assembly, and moving
it onto `buildRig` is a separate change with its own React concerns. A new test pins
`buildRig` to a copy of `EcuLab.jsx`'s `sweepArgs` assembly written out in the test: for
every preset, the two pulls must be equal. That catches `buildRig` drifting. It can't
catch `EcuLab.jsx` changing on its own, which is why moving the app onto `buildRig` is
the real fix, and it's listed under Out of scope.

### `bot/lib/handler.js` and `bot/api/interactions.js`: the endpoint

`createHandler({ publicKey, waitUntil, render, fetch, sha })` returns a Web-standard
`(request) => Response`. `api/interactions.js` exports it as a Vercel Node function's
`POST`, passing in `waitUntil` from `@vercel/functions`, `svgToPng` from `render.js`,
the global `fetch`, `DISCORD_PUBLIC_KEY` and `VERCEL_GIT_COMMIT_SHA`. A Web handler gives
the raw body, which the signature check needs. In order:

1. **Verify the signature** (`lib/verify.js`) from the `X-Signature-Ed25519` and
   `X-Signature-Timestamp` headers and the raw body, against `DISCORD_PUBLIC_KEY`. It uses
   Node's own `crypto.verify` with an Ed25519 key built from the public key's 32 raw bytes,
   so it needs no dependency. A missing or bad signature gets `401` and nothing else.
   Discord tests this when the URL is first saved and refuses an endpoint that accepts
   unsigned requests.
2. **`PING` (type 1)** gets `{ type: 1 }`.
3. **`/dyno` (type 2, name `dyno`)**:
   - It responds at once with type 5, a deferred reply: Discord shows "ECU Lab Dyno is
     thinking…".
   - It hands the work to `waitUntil`, which keeps the function alive after the response
     has gone.
   - The work runs both pulls, draws the chart and edits the original reply through
     `PATCH /webhooks/{application_id}/{token}/messages/@original`. The edit is a
     multipart request that carries the PNG as `dyno.png`, with the embed's
     `image.url: "attachment://dyno.png"`.
   - The application id and token come from the interaction itself. No bot token is
     needed at runtime.
4. **Anything else** gets an ephemeral "Unknown command" reply (flags 64).

The only Vercel environment variable is `DISCORD_PUBLIC_KEY`. It is public by design;
Discord shows it on the app's page. `VERCEL_GIT_COMMIT_SHA` comes from Vercel and feeds the
footer.

### `lib/dyno.js`: options to pulls

`runDyno({ engine, intake, exhaust, headers, fuel })` returns
`{ preset, mods, fuel, stock, modified }`. Each pull is `buildRig(...).pull()`. `stock` is
the preset as it ships. `modified` takes the preset's mods with any given options laid
over them, and the chosen fuel's `octaneIdx` in `build`. If nothing differs from stock, it
runs the pull once and returns the same result for both. It throws a `DynoInputError` for
an unknown engine id or fuel label, which can happen if the command was registered
against an older build.

### `lib/chart.js`: pulls to SVG

`dynoChartSvg({ stock, modified, title })` returns an SVG string, 1000 × 560, on the
app's dark background (`tokens.bg`). It mirrors `src/ui/screens/dyno/ResultScreen.jsx`:

- power in `tokens.acc` and torque in `tokens.cyan`, 2 px wide
- the stock curves in the same colours, dashed `5 4` at 0.5 opacity, drawn only when the
  build differs from stock
- the grid in `tokens.line`, axis text in `tokens.ink2`
- RPM from 1500 to the pull's last point on x; one shared y axis for whp and
  lb-ft, as the app draws them
- a legend: `WHP`, `Torque`, `Stock WHP`, `Stock TQ`

Colours are imported from `src/ui/tokens.js`, never retyped, so a palette change reaches
the bot too. Text uses `font-family="Roboto"` only, because resvg sees only the bundled
font. Every string written into the SVG is XML-escaped.

### `bot/render.js`: SVG to PNG

`svgToPng(svg)` runs resvg with `fitTo: { mode: 'width', value: 1000 }`, the bundled
`fonts/Roboto-Regular.ttf` as its only font file, and system fonts turned off. It returns
a PNG `Buffer`. This is the only module that loads resvg, so everything else can be tested
without it.

### `lib/reply.js`: the message

`dynoReply({ preset, mods, fuel, stock, modified, sha })` returns the edit body:
`{ embeds: [embed], attachments: [{ id: 0, filename: 'dyno.png' }] }`.

- **Title.** `<preset name> · <parts> · factory tune`. `<parts>` is the fitted bolt-ons
  by their `MOD_INFO` labels, joined with ` + `, then the fuel if it isn't the preset's
  own. It reads `stock` if nothing changed.
- **Description.**
  - Line 1 is peak power and torque, rounded, with signed whole-number differences from
    stock (`+1`, `−3`, `±0`). The differences are left out for a stock pull.
  - Then up to three events, highest `severity` first, then the order the sim logged
    them. Each shows its `msg` behind ⚠️ (severity 1 or 2) or 🛑 (severity 3).
  - Past three, a final line says `…and N more in the app`.
  - With no events at all, it says `Clean pull, no warnings.`
- **Colour.** `tokens.danger` if any event is severity 3, `tokens.warn` for 1 or 2, and
  `tokens.ok` for a clean pull. Each is converted from its hex string to the integer Discord
  wants, not retyped.
- **Footer.** `main @ <first 7 of sha> (unreleased) · ECU Lab sim`. Locally, with no sha,
  it reads `local build`.
- **Image.** `attachment://dyno.png`.

The embed is built with `buildPayload` from `scripts/discord-notify.js`, so Discord's
length limits are enforced by the same code the workflows use. The image is then added
to that embed.

### `lib/command.js` and `scripts/register.js`

`dynoCommand()` builds the command definition (name, description, options, choices)
from `ENGINE_PRESETS` and `OCTANE_OPTS`. `register.js` sends it with
`PUT /applications/{DISCORD_APP_ID}/guilds/{DISCORD_GUILD_ID}/commands`, using
`DISCORD_BOT_TOKEN`.

All three values come from the environment of whoever runs it, on their own machine. The token is never stored in the repo, in GitHub or in Vercel. A `PUT` replaces
the server's whole command list, so running it again is safe. It must be re-run whenever a
preset or fuel is added; the bot's `DynoInputError` reply says so.

### Deploys: `vercel.json` and `scripts/should-build.sh`

- The Vercel project's Root Directory is `bot/`, with "Include files outside the Root
  Directory" on (the default), so `../src/sim` and `../src/ui/tokens.js` are bundled.
- `vercel.json` sets `ignoreCommand` to `bash scripts/should-build.sh`. Vercel builds
  when the command exits 1 and skips when it exits 0. The script:
  - exits 0 if `VERCEL_GIT_COMMIT_REF` isn't `main`, so branches and pull requests,
    forks included, never get a live preview bot
  - otherwise exits 1 if `git diff --quiet HEAD^ HEAD -- . ../src/sim ../src/ui/tokens.js
    ../scripts/discord-notify.js` finds changes (everything the bot imports), and 0 if not
- `maxDuration` is 15 s. The work takes about 1 s, and Discord allows 15 minutes for the
  edit.

## Error handling

| What goes wrong | What the user sees | What's logged |
| --- | --- | --- |
| Bad or missing signature | nothing (`401`) | nothing; this is Discord's own probe or noise |
| Unknown engine or fuel (stale registration) | the reply edits to "That engine/fuel isn't in this build of the sim. The command needs re-registering." | a warning with the bad value |
| The pull throws, or a peak comes back non-finite | "The pull crashed. That's a bug in the sim: please report it with this line:" and the footer | the stack, with the options |
| The chart fails to render | the normal reply without the image, plus a line saying the chart couldn't be drawn | the stack |
| The edit to Discord fails | the "thinking…" message stays until Discord times it out after 15 minutes | the status code and response body (never the token) |

Every error path logs through `console.error`, which shows in Vercel's function logs.

## Testing

The pure modules are tested by the root suite, so `npm test`, `npm run lint` and
`npm run typecheck` cover them and CI catches regressions without a new job. Vitest's
`tests/**` pattern already picks up `tests/bot/`. Root `tsconfig.json`'s `include` gains
`bot/lib` and `bot/scripts/register.js` (not `preview.js`, which loads resvg), and the ESLint `ignores` gain `bot/node_modules/**`.

- **`tests/rig.test.js`.** For each preset, `buildRig({preset}).pull()` equals the
  copy of `EcuLab.jsx`'s assembly. A bolt-on build moves `veTruth` and differs from stock,
  which guards against the `veTruth: patch.ve` mistake.
- **`tests/bot/verify.test.js`.** Uses a key pair generated in the test: a correct
  signature passes; a changed body, timestamp or signature fails; a missing header fails;
  a malformed key fails without throwing.
- **`tests/bot/dyno.test.js`.** Left-out options fall back to the preset's own. A build
  identical to stock runs one pull. Unknown ids and labels throw `DynoInputError`.
- **`tests/bot/chart.test.js`.** The SVG parses as XML. It has the two lines and the
  stock overlay only when the build differs from stock. It escapes a title containing
  `<&>`. It uses only token colours.
- **`tests/bot/reply.test.js`.** The title for stock and for modified builds; signed
  differences, including `±0`; events ordered by severity with the overflow line; the
  colour per worst severity; the footer with and without a sha; the length limits.
- **`tests/bot/command.test.js`.** One choice per preset and per fuel, with values that
  `runDyno` accepts. Labels are within Discord's 100-character limit and there are no
  more than 25 choices.
- **`tests/bot/handler.test.js`.** Drives `createHandler` with a generated key pair and
  stubbed `fetch`, `waitUntil` and `render`. `PING` gets the pong; unsigned gets `401`; `/dyno` gets type 5 and then
  a multipart `PATCH` to the right URL with a PNG part. A thrown pull edits to the crash
  message, and a throwing `render` gives the reply without the image.
- **`bot/` smoke test, by hand.** Run `npm ci` in `bot/`, then `node bot/scripts/preview.js
  <dir>` to render a real PNG for each preset into `<dir>`, and look at them. The root CI
  job never loads resvg's native binary, so this is the only check of `render.js` and
  `api/interactions.js`. The first deploy is the check of the Vercel wiring: Discord
  refuses to save the endpoint URL unless it answers the signed `PING` and rejects an
  unsigned one.

Everything runs on Node 22, the same version as the rest of the repo.

## What Danny sets up by hand

None of these steps go through Claude, and none of them involve secrets in the repo.

1. **Discord Developer Portal.** Create an application named "ECU Lab Dyno", add a bot,
   and invite it to the server with the `applications.commands` scope only. It needs no
   bot permissions: it never reads messages.
2. **Vercel.** Create a Hobby account and import `DNiev/ecu-lab`, giving the GitHub app
   access to that one repository. Set the Root Directory to `bot/` and add the
   `DISCORD_PUBLIC_KEY` environment variable.
3. Paste the deployment's `https://…/api/interactions` URL into the app's
   **Interactions Endpoint URL** in the Developer Portal. Discord checks it on save.
4. Run `node bot/scripts/register.js` once, with `DISCORD_APP_ID`, `DISCORD_GUILD_ID` and
   `DISCORD_BOT_TOKEN` set in that shell only.
5. In Discord, under Server Settings → Integrations → ECU Lab Dyno, limit `/dyno` to the
   testers' channel or role.

`bot/README.md` gives these steps in this order, and CLAUDE.md gains one line: the bot
deploys from `main`, and the Vercel project and Discord app belong to the owner.

## Out of scope

- Custom calibrations, tuning tables or any other build beyond preset, bolt-ons and fuel.
- Flex fuel, nitrous, superchargers and turbo changes.
- A "Why?" button showing each warning's `cause` and `fix`.
- Moving `EcuLab.jsx` onto `buildRig`.
- Slack, other servers, or a global command.
