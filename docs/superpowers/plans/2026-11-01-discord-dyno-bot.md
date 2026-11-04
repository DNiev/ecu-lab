# `/dyno` Discord Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/dyno` slash command for the ECU Lab testers' Discord server. It runs the app's real dyno pull for a factory engine, optionally with bolt-ons and a different fuel, and replies with peaks, differences from stock, the pull log's warnings and a PNG chart.

**Architecture:** The app's full dyno pull moves from `tests/ecuHarness.js` into `src/sim/rig.js` (`buildRig`), so the bot and the tests share one assembly. The bot lives in `bot/`:
- `bot/lib/` holds all the logic and uses no packages (signature check, options to pulls, SVG chart, reply, request handler), so the root `npm test`, lint and typecheck cover it.
- Two small runtime files use the bot's own dependencies: `bot/render.js` (resvg) and `bot/api/interactions.js` (Vercel).
- It deploys from `main` through Vercel's GitHub app.

**Tech Stack:**
- Node 22 ESM, vitest 2, plain JS with JSDoc types checked by `tsc --checkJs`
- `@resvg/resvg-js@2.6.2` (SVG to PNG) and `@vercel/functions@3.10.1` (`waitUntil`)
- Discord HTTP interactions (API v10) and Node's built-in `crypto` (Ed25519)

**Spec:** `docs/superpowers/specs/2026-10-28-discord-dyno-bot-design.md`

## Global Constraints

- Node 22 locally (`source ~/.nvm/nvm.sh && nvm use` in the repo). CI also runs Node 20, so use nothing newer than Node 20 has.
- Gates before the PR: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, all on Node 22. Never pipe `npm test` into `tail` or `grep` without checking vitest's own exit status: a pipe hides the failure.
- `tests/fixtures/fingerprint.sha256` must stay byte-identical. This work changes no physics.
- `bot/lib/` imports only Node built-ins, `src/sim`, `src/ui/tokens.js` and `scripts/discord-notify.js`, never anything from `bot/node_modules`.
- Colours come from `tokens` in `src/ui/tokens.js` and are never retyped as hex.
- Dependencies are pinned exactly: `@resvg/resvg-js` `2.6.2` and `@vercel/functions` `3.10.1`. Nothing is added to the root `package.json`.
- Secrets: the bot's only runtime setting is `DISCORD_PUBLIC_KEY`, which is public. The bot token is used only by `bot/scripts/register.js`, from the environment of whoever runs it. Never log a token or a webhook/interaction URL.
- Discord API base: `https://discord.com/api/v10`.
- Comments explain why, in the repo's thorough teaching style. Match the surrounding code.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

| File | Task | Responsibility |
| --- | --- | --- |
| `src/sim/rig.js` | 1 | `buildRig(opts)`: the app's full dyno pull, as a pure function |
| `src/sim/index.js` | 1 | re-export `rig.js` |
| `tests/ecuHarness.js` | 1 | `makeEngine` becomes `buildRig`; `runLive` and `at` stay |
| `tests/rig.test.js` | 1 | `buildRig` matches the app's assembly; bolt-ons move the result |
| `eslint.config.js` | 2, 7 | Web/Node globals; ignore `bot/node_modules/**` |
| `tsconfig.json` | 2, 7 | include `bot/lib`, `bot/scripts/register.js` |
| `bot/lib/verify.js` | 2 | Discord Ed25519 request check |
| `bot/lib/command.js` | 3 | the `/dyno` command definition, built from the sim |
| `bot/lib/dyno.js` | 3 | command options → stock pull and modified pull |
| `bot/lib/chart.js` | 4 | pulls → SVG |
| `bot/lib/reply.js` | 5 | pulls → Discord message bodies |
| `bot/lib/handler.js` | 6 | request handler, with its runtime passed in |
| `bot/package.json`, `bot/package-lock.json` | 7 | the bot's own dependencies |
| `bot/render.js` | 7 | SVG → PNG with resvg and the bundled font |
| `bot/api/interactions.js` | 7 | Vercel entry: wires the runtime into the handler |
| `bot/vercel.json` | 7 | function settings and the ignore step |
| `bot/scripts/should-build.sh` | 7 | build only on `main`, only when something the bot uses changed |
| `bot/scripts/register.js` | 7 | registers `/dyno` for one server |
| `bot/scripts/preview.js` | 7 | renders every preset's chart to PNG files |
| `bot/fonts/Roboto-Regular.ttf`, `bot/fonts/LICENSE` | 7 | the chart font (resvg cannot read WOFF/WOFF2) |
| `bot/README.md`, `CLAUDE.md` | 7 | setup steps; one line for agents |
| `tests/bot/*.test.js` | 2–7 | tests for each module |

---

### Task 1: `buildRig`: the app's dyno pull in `src/sim`

**Files:**
- Create: `src/sim/rig.js`
- Modify: `src/sim/index.js` (add one export line)
- Modify: `tests/ecuHarness.js` (replace `makeEngine`'s body)
- Test: `tests/rig.test.js`

**Interfaces:**
- Produces: `buildRig(opts?)` exported from `src/sim/index.js`.
  - `opts`: `{ preset?: string, build?: object, cal?: Record<string, any>, env?: object, faults?: Record<string,string>, nitrousArmed?: boolean, bottleK?: number }`.
  - Returns `{ build, derived, cal, hw, tables, veTruth, fuel, turbine, compressor, pull(loadKpa = 100, { legacy, gear } = {}), liveCfg(aux) }`.
  - `pull()` returns `simulateSweep`'s result: `{ points: {rpm, hp, torque, …}[], events: {type, severity, impact, rpmStart, rpmEnd, msg, cause, fix}[], wear, peakHp, peakTq, loadKpa, needsMafRecal }`.
- `tests/ecuHarness.js` keeps exporting `makeEngine` (now `=== S.buildRig`), `runLive` and `at`, so the existing tests are untouched.

- [ ] **Step 1: Write the failing test**

Create `tests/rig.test.js`:

```js
/**
 * `buildRig` is the app's dyno pull, taken out of React so the Discord bot and the tests
 * run what the app runs.
 *
 * The first block pins it to a copy of EcuLab.jsx's own assembly (the `hwForVe`, `veTruth`,
 * `ecuHw`, `ecuBundle` and `sweepArgs` it builds from state), written out here on purpose
 * rather than imported. If `buildRig` drifts from the app, this fails. It cannot notice
 * EcuLab.jsx changing on its own — moving the app onto `buildRig` is what closes that.
 */

import { describe, expect, it } from 'vitest';

import * as S from '../src/sim/index.js';

/** A preset's dyno pull, assembled the way EcuLab.jsx assembles it from its state. */
function appPull(presetId) {
  const p = S.applyPreset(S.presetById(presetId));
  const build = {
    engineConfig: p.engineConfig, mods: p.mods, turboOn: p.turboOn, boostCurve: p.boostCurve,
    octaneIdx: p.octaneIdx, injIdx: p.injIdx, ecuInjectorCc: p.ecuInjectorCc,
    turbineIdx: p.turbineIdx, turbineCount: p.turbineCount, compressorIdx: p.compressorIdx,
    exhaustDiaIdx: p.exhaustDiaIdx, ethanolPct: 0,
  };
  const fuel = S.tankFuel(build);
  const turbine = S.turbineWithCount(S.TURBINE_OPTS[build.turbineIdx], build.turbineCount);
  const blower = S.blowerOf(build);
  const hwForVe = {
    turboOn: build.turboOn,
    turbine: build.turboOn ? turbine : null,
    exhaustDia: S.EXHAUST_DIA_OPTS[build.exhaustDiaIdx].dia,
    fuel,
    peakBoostPsi: build.turboOn ? Math.max(...build.boostCurve) : 0,
    supercharged: !!blower,
  };
  const veTruth = S.computeHardwareVE(build.engineConfig, build.mods, hwForVe);
  const ecuHw = { ...S.ecuHardwareOf(build), veTruthByPhase: S.veTruthByPhaseFor(build.engineConfig, build.mods, hwForVe) };
  const ecuBundle = { cal: p.ecu, hw: ecuHw, cond: S.dynoConditions({ ...S.DEFAULT_ENV }, {}, null) };
  return S.simulateSweep({
    loadKpa: 100, ve: p.ve, veTruth, timing: p.timing, afr: p.afr,
    turboOn: build.turboOn, boostCurve: build.boostCurve, octaneBonus: fuel.bonus, octaneLabel: fuel.label,
    fuel, injectorCc: S.INJECTOR_OPTS[build.injIdx].cc, ecuInjectorCc: build.ecuInjectorCc,
    injectorLabel: S.INJECTOR_OPTS[build.injIdx].label, mods: build.mods, mafScalar: 1,
    derived: S.deriveEngine(build.engineConfig),
    turbine, compressor: S.COMPRESSOR_OPTS[build.compressorIdx], ecu: ecuBundle,
  });
}

describe('buildRig', () => {
  S.ENGINE_PRESETS.forEach((preset) => {
    it(`pulls ${preset.name} exactly as the app does`, () => {
      expect(S.buildRig({ preset: preset.id }).pull()).toEqual(appPull(preset.id));
    });
  });

  it('feeds bolt-ons into the true airflow, not just the label', () => {
    // The trap this guards: passing a preset's own VE table as `veTruth` ignores every
    // part, so intake + headers came out at exactly the stock figures.
    const preset = S.presetById('vq35hr');
    const stock = S.buildRig({ preset: preset.id });
    const modded = S.buildRig({ preset: preset.id, build: { mods: { ...preset.mods, intake: true, headers: true } } });
    expect(modded.veTruth).not.toEqual(stock.veTruth);
    expect(modded.pull().peakTq).not.toBe(stock.pull().peakTq);
  });

  it('is what the ECU test harness hands out', async () => {
    const { makeEngine } = await import('./ecuHarness.js');
    expect(makeEngine).toBe(S.buildRig);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `source ~/.nvm/nvm.sh && nvm use >/dev/null && npx vitest run tests/rig.test.js`
Expected: FAIL. The first errors are `S.buildRig is not a function`.

- [ ] **Step 3: Create `src/sim/rig.js`**

This is `makeEngine`'s body from `tests/ecuHarness.js`, with direct imports in place of `S.` and with one deliberate change: `injectorLabel` is the real injector label instead of `'x'`, because the app passes the label and it appears in the injector-duty event's `cause` text. The fingerprint hashes `msg`, not `cause`, and doesn't use the harness, so it can't move.

```js
/**
 * A whole engine on the dyno, assembled exactly the way the app assembles it.
 *
 * EcuLab.jsx builds a dyno pull out of React state: the true breathing curve from the
 * hardware as fitted, the fuel from the tank, the engine management's hardware from the
 * build, and the ECU in the loop. This is that assembly as a pure function, so code outside
 * the UI — the ECU tests, the Discord bot — runs the pull the app runs rather than an
 * approximation of it.
 *
 * The approximation is easy to fall into. Passing a preset's own VE table as `veTruth`
 * looks right and runs, but the true airflow then never sees the parts: bolt an intake and
 * headers on and the pull comes out at exactly the stock figures. Here `veTruth` always
 * comes from `computeHardwareVE` for the parts actually fitted, and the VE table stays the
 * ECU's (possibly wrong) belief about it, which is the whole lesson of the app.
 *
 * EcuLab.jsx still has its own copy. `tests/rig.test.js` pins this one to it.
 */

import { computeHardwareVE } from './airflow.js';
import { blowerOf } from './blower.js';
import { defaultEcuCalibration, setCal } from './ecu/calibration.js';
import { dynoConditions, ecuHardwareOf, tankFuel, veTruthByPhaseFor } from './ecu/context.js';
import { deriveEngine } from './engine.js';
import { COMPRESSOR_OPTS, EXHAUST_DIA_OPTS, INJECTOR_OPTS, TURBINE_OPTS, turbineWithCount } from './hardware.js';
import { clone2D } from './math.js';
import { applyPreset, presetById } from './presets.js';
import { mafErrorFactor, simulateSweep } from './sweep.js';
import { DEFAULT_AFR, DEFAULT_BOOST, DEFAULT_ENGINE_CONFIG, DEFAULT_MODS, DEFAULT_TIMING } from './tables.js';

/**
 * Builds an engine on the dyno, from a preset or the app's default build.
 *
 * @param {object} [opts]
 * @param {string} [opts.preset] a preset id; otherwise the app's default build
 * @param {object} [opts.build] build fields to override (e.g. `mods`, `octaneIdx`)
 * @param {Record<string, any>} [opts.cal] calibration paths to override, as `setCal` takes them
 * @param {object} [opts.env] ambient conditions
 * @param {Record<string, string>} [opts.faults]
 * @param {boolean} [opts.nitrousArmed] a nitrous kit's arming switch on the dyno (default on)
 * @param {number} [opts.bottleK] the bottle's temperature at the start of the pull
 */
export function buildRig({ preset, build: patch = {}, cal: calPatch = {}, env, faults, nitrousArmed = true, bottleK } = {}) {
  const p = preset ? applyPreset(presetById(preset)) : null;
  const build = {
    engineConfig: p?.engineConfig ?? DEFAULT_ENGINE_CONFIG,
    mods: p?.mods ?? DEFAULT_MODS,
    turboOn: p?.turboOn ?? false,
    boostCurve: p?.boostCurve ?? [...DEFAULT_BOOST],
    octaneIdx: p?.octaneIdx ?? 0,
    injIdx: p?.injIdx ?? 0,
    ecuInjectorCc: p?.ecuInjectorCc ?? 315,
    turbineIdx: p?.turbineIdx ?? 1,
    turbineCount: p?.turbineCount ?? 1,
    compressorIdx: p?.compressorIdx ?? 1,
    exhaustDiaIdx: p?.exhaustDiaIdx ?? EXHAUST_DIA_OPTS.findIndex((o) => o.dia === 3.0),
    ethanolPct: 0,
    ...patch,
  };
  const turbine = turbineWithCount(TURBINE_OPTS[build.turbineIdx], build.turbineCount);
  const compressor = COMPRESSOR_OPTS[build.compressorIdx];
  const fuel = tankFuel(build);
  const hwForVe = {
    turboOn: build.turboOn, turbine: build.turboOn ? turbine : null,
    exhaustDia: EXHAUST_DIA_OPTS[build.exhaustDiaIdx].dia, fuel,
    peakBoostPsi: build.turboOn ? Math.max(...build.boostCurve) : 0,
    supercharged: !!blowerOf(build),
  };
  const veTruth = computeHardwareVE(build.engineConfig, build.mods, hwForVe);
  const derived = deriveEngine(build.engineConfig);
  const hw = { ...ecuHardwareOf(build), veTruthByPhase: veTruthByPhaseFor(build.engineConfig, build.mods, hwForVe) };
  let cal = p?.ecu ?? defaultEcuCalibration({ derived, gate: hw.gate });
  for (const [k, v] of Object.entries(calPatch)) cal = setCal(cal, k, v);
  const tables = {
    ve: p?.ve ?? veTruth,
    timing: p?.timing ?? clone2D(DEFAULT_TIMING),
    afr: p?.afr ?? clone2D(DEFAULT_AFR),
  };
  const blower = blowerOf(build);
  const sweepArgs = (loadKpa = 100) => ({
    loadKpa, ...tables, veTruth, turboOn: build.turboOn, boostCurve: build.boostCurve,
    octaneLabel: fuel.label, fuel, injectorCc: INJECTOR_OPTS[build.injIdx].cc,
    ecuInjectorCc: build.ecuInjectorCc, injectorLabel: INJECTOR_OPTS[build.injIdx].label,
    mods: build.mods, mafScalar: 1, derived, turbine, compressor,
    ...(blower ? { blower, blowerRatio: build.blowerRatio ?? blower.defaultRatio } : {}),
    ...(build.nitrous ? { nitrous: build.nitrous } : {}),
  });
  const nitrousCond = build.nitrous ? { armed: nitrousArmed, heater: !!build.nitrous.heater, ...(bottleK ? { bottleK } : {}) } : null;
  const ecu = (cond) => ({ cal, hw: build.nitrous ? { ...hw, nitrous: build.nitrous } : hw, cond: cond ?? dynoConditions(env, faults, nitrousCond) });
  return {
    build, derived, cal, hw, tables, veTruth, fuel, turbine, compressor,
    /**
     * A dyno pull with the ECU in the loop (or without it, `legacy`).
     * @param {number} [loadKpa]
     * @param {{legacy?: boolean, gear?: number}} [opts]
     */
    pull: (loadKpa = 100, { legacy = false, gear = undefined } = {}) => simulateSweep({
      ...sweepArgs(loadKpa),
      ...(legacy ? {} : { ecu: gear ? { ...ecu(), cond: { ...ecu().cond, gear } } : ecu() }),
    }),
    /** The live engine config, as EcuLab builds it. */
    liveCfg: (aux = {}) => ({
      ...sweepArgs(), ve: tables.ve, timing: tables.timing, afr: tables.afr,
      mafErrorBase: mafErrorFactor(build.mods, build.turboOn),
      ecu: { ...ecu(dynoConditions(env, faults)), aux },
    }),
  };
}
```

Before saving, diff this against the current `makeEngine` in `tests/ecuHarness.js` (lines 19–83), line by line. The only differences allowed are `S.` → direct imports and `injectorLabel`. If the harness has changed on `main` since this plan was written, copy the harness's current body and apply only those two changes.

- [ ] **Step 4: Export it and point the harness at it**

In `src/sim/index.js`, add after `export * from './scoring.js';`:

```js
export * from './rig.js';
```

In `tests/ecuHarness.js`, replace the header comment, the JSDoc and the whole `makeEngine` function (from the file's top to the closing `}` of `makeEngine`, just before `runLive`'s JSDoc) with:

```js
/**
 * Builds engines for the ECU tests exactly the way the app does (EcuLab.jsx), and runs
 * the live engine through a throttle schedule.
 *
 * The assembly itself is `buildRig` in src/sim/rig.js, shared with the Discord bot.
 * `makeEngine` is kept as its name here so the tests read as they always have.
 */

import * as S from '../src/sim/index.js';

/** See `buildRig` in src/sim/rig.js. */
export const makeEngine = S.buildRig;
```

Leave `runLive` and `at` exactly as they are.

- [ ] **Step 5: Run the new test, then the suites that use the harness**

Run: `npx vitest run tests/rig.test.js`
Expected: PASS, 9 tests (7 presets, bolt-ons, harness identity).

Run: `npx vitest run tests/ecu.test.js tests/blower.test.js tests/nitrous.test.js tests/accuracy-claims.test.js tests/physics-invariants.test.js tests/consistency-fuzz.test.js tests/tuning-consistency.test.js tests/ve-learn.test.js tests/fingerprint.test.js; echo "vitest exit $?"`
Expected: all pass, `vitest exit 0`.

- [ ] **Step 6: Prove the fingerprint didn't move, then run the gates**

Run: `git diff --quiet tests/fixtures/fingerprint.sha256 && echo "fingerprint untouched"`
Expected: `fingerprint untouched`

Run: `npm test; echo "vitest exit $?"` then `npm run lint && npm run typecheck`
Expected: `vitest exit 0`; lint and typecheck clean. If `tests/ui/routing-shell.test.jsx` › "does not have to step through dead entries…" fails, rerun that file alone. It's a known flaky test, unrelated to this work. Report it either way.

- [ ] **Step 7: Commit**

```bash
git add src/sim/rig.js src/sim/index.js tests/ecuHarness.js tests/rig.test.js
git commit -m "Move the app's dyno pull assembly into src/sim as buildRig

The ECU test harness assembled the app's full pull (true airflow from the
fitted parts, fuel from the tank, the ECU in the loop). The Discord bot needs
the same thing, so it now lives in src/sim/rig.js and the harness re-exports
it. No physics changes: the fingerprint is byte-identical.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Discord request signature check

**Files:**
- Create: `bot/lib/verify.js`
- Modify: `eslint.config.js` (globals)
- Modify: `tsconfig.json` (`include`)
- Test: `tests/bot/verify.test.js`

**Interfaces:**
- Produces: `verifyDiscordRequest({ publicKey, signature, timestamp, body }): boolean`. All four are strings, or `null`/`undefined` when missing. `publicKey` is 64 hex characters and `signature` is 128. It never throws.

- [ ] **Step 1: Write the failing test**

Create `tests/bot/verify.test.js`:

```js
/**
 * Discord signs every interaction request with the app's Ed25519 key, and refuses to
 * save an endpoint that accepts an unsigned one. These use a key pair made in the test,
 * so no real key is ever needed.
 */

import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { verifyDiscordRequest } from '../../bot/lib/verify.js';

const { publicKey: pub, privateKey } = generateKeyPairSync('ed25519');
// Discord shows the public key as 64 hex characters: the raw 32-byte key.
const publicKey = Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url').toString('hex');
const timestamp = '1730000000';
const body = '{"type":1}';
const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');

describe('verifyDiscordRequest', () => {
  it('accepts a correctly signed request', () => {
    expect(verifyDiscordRequest({ publicKey, signature, timestamp, body })).toBe(true);
  });

  it('rejects a changed body', () => {
    expect(verifyDiscordRequest({ publicKey, signature, timestamp, body: '{"type":2}' })).toBe(false);
  });

  it('rejects a changed timestamp', () => {
    expect(verifyDiscordRequest({ publicKey, signature, timestamp: '1730000001', body })).toBe(false);
  });

  it('rejects a changed signature', () => {
    const flipped = (signature[0] === '0' ? '1' : '0') + signature.slice(1);
    expect(verifyDiscordRequest({ publicKey, signature: flipped, timestamp, body })).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifyDiscordRequest({ publicKey, signature: null, timestamp, body })).toBe(false);
    expect(verifyDiscordRequest({ publicKey, signature, timestamp: undefined, body })).toBe(false);
  });

  it('rejects, without throwing, a malformed key or signature', () => {
    expect(verifyDiscordRequest({ publicKey: 'not hex', signature, timestamp, body })).toBe(false);
    expect(verifyDiscordRequest({ publicKey: publicKey.slice(2), signature, timestamp, body })).toBe(false);
    expect(verifyDiscordRequest({ publicKey: undefined, signature, timestamp, body })).toBe(false);
    expect(verifyDiscordRequest({ publicKey, signature: 'abc', timestamp, body })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/bot/verify.test.js`
Expected: FAIL. The import can't resolve `bot/lib/verify.js`.

- [ ] **Step 3: Implement `bot/lib/verify.js`**

```js
/**
 * Checks that a request really came from Discord.
 *
 * The endpoint is a public URL, so anyone can POST to it. Discord signs each request with
 * the app's Ed25519 private key over `timestamp + body`; checking that signature against
 * the app's public key is the only thing standing between the endpoint and anyone who
 * finds the URL. Discord also tests this when the URL is saved, and refuses an endpoint
 * that accepts a request with a bad signature.
 *
 * Node's own crypto does Ed25519, so this needs no dependency. Discord gives the public key
 * as 64 hex characters (the raw 32-byte key); Node wants a key object, which a JWK with that
 * key as `x` provides.
 */

import { createPublicKey, verify } from 'node:crypto';

const HEX_KEY = /^[0-9a-f]{64}$/i;
const HEX_SIGNATURE = /^[0-9a-f]{128}$/i;

/**
 * @param {{ publicKey?: string | null, signature?: string | null, timestamp?: string | null, body: string }} request
 * @returns {boolean} true only for a well-formed, correctly signed request
 */
export function verifyDiscordRequest({ publicKey, signature, timestamp, body }) {
  if (!publicKey || !HEX_KEY.test(publicKey)) return false;
  if (!signature || !HEX_SIGNATURE.test(signature)) return false;
  if (!timestamp) return false;
  try {
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey, 'hex').toString('base64url') },
      format: 'jwk',
    });
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, 'hex'));
  } catch {
    // A key Node cannot load is a misconfiguration, not a valid request.
    return false;
  }
}
```

- [ ] **Step 4: Teach lint and typecheck about the bot**

In `eslint.config.js`, add these to the `globals` object, after `Blob: 'readonly',`. Later tasks use `Response`, `Request`, `FormData` and `Headers`, so add them all now:

```js
        Buffer: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        FormData: 'readonly',
```

In `tsconfig.json`, add `"bot/lib"` to `include`, after `"electron"`:

```json
    "electron",
    "bot/lib"
```

- [ ] **Step 5: Run the test, lint and typecheck**

Run: `npx vitest run tests/bot/verify.test.js && npm run lint && npm run typecheck`
Expected: 6 tests pass; lint and typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add bot/lib/verify.js tests/bot/verify.test.js eslint.config.js tsconfig.json
git commit -m "Add the Discord request signature check for the /dyno bot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The command definition and options → pulls

**Files:**
- Create: `bot/lib/command.js`
- Create: `bot/lib/dyno.js`
- Test: `tests/bot/command.test.js`
- Test: `tests/bot/dyno.test.js`

**Interfaces:**
- Consumes: `buildRig` (Task 1), plus `ENGINE_PRESETS`, `OCTANE_OPTS`, `MOD_INFO` and `presetById` from `src/sim/index.js`.
- Produces:
  - `MOD_KEYS = ['intake', 'exhaust', 'headers']`, exported from `bot/lib/dyno.js`.
  - `dynoCommand(): object`, the Discord command definition.
  - `class DynoInputError extends Error`, with a `value` property: the bad input.
  - `runDyno({ engine, intake?, exhaust?, headers?, fuel? })`. It returns `{ preset, mods, fuel, isStock, stock, modified }`:
    - `fuel` is an `OCTANE_OPTS` entry.
    - `stock` and `modified` are pull results (`=== ` each other when `isStock`).

- [ ] **Step 1: Write the failing tests**

Create `tests/bot/dyno.test.js`:

```js
import { describe, expect, it } from 'vitest';

import * as S from '../../src/sim/index.js';
import { DynoInputError, MOD_KEYS, runDyno } from '../../bot/lib/dyno.js';

describe('runDyno', () => {
  it('runs the preset as it ships when no options are given, and pulls once', () => {
    const r = runDyno({ engine: 'vq35hr' });
    const preset = S.presetById('vq35hr');
    expect(r.preset).toBe(preset);
    expect(r.isStock).toBe(true);
    expect(r.modified).toBe(r.stock);
    expect(r.mods).toEqual(preset.mods);
    expect(r.fuel).toBe(S.OCTANE_OPTS[preset.parts.octaneIdx]);
    expect(r.stock).toEqual(S.buildRig({ preset: 'vq35hr' }).pull());
  });

  it('treats options that match the preset as stock', () => {
    const preset = S.presetById('vq35hr');
    const r = runDyno({ engine: 'vq35hr', intake: preset.mods.intake, fuel: S.OCTANE_OPTS[preset.parts.octaneIdx].label });
    expect(r.isStock).toBe(true);
  });

  it('lays given bolt-ons over the preset and keeps the factory tune', () => {
    const preset = S.presetById('vq35hr');
    const r = runDyno({ engine: 'vq35hr', intake: true, headers: true });
    expect(r.isStock).toBe(false);
    expect(r.mods).toEqual({ ...preset.mods, intake: true, headers: true });
    expect(r.modified).toEqual(S.buildRig({ preset: 'vq35hr', build: { mods: r.mods } }).pull());
    expect(r.stock).toEqual(S.buildRig({ preset: 'vq35hr' }).pull());
  });

  it('runs a different fuel by its label', () => {
    const e85 = S.OCTANE_OPTS.findIndex((o) => o.label === 'E85');
    const r = runDyno({ engine: 'b58-m1', fuel: 'E85' });
    expect(r.fuel).toBe(S.OCTANE_OPTS[e85]);
    expect(r.modified).toEqual(S.buildRig({ preset: 'b58-m1', build: { mods: r.mods, octaneIdx: e85 } }).pull());
  });

  it('rejects an unknown engine or fuel with the bad value', () => {
    expect(() => runDyno({ engine: 'sr20det' })).toThrow(DynoInputError);
    try { runDyno({ engine: 'vq35hr', fuel: 'diesel' }); } catch (e) {
      expect(e).toBeInstanceOf(DynoInputError);
      expect(e.value).toBe('diesel');
    }
    expect(() => runDyno({ engine: 'vq35hr', fuel: 'diesel' })).toThrow(DynoInputError);
  });

  it('offers exactly the bolt-ons the sim has labels for', () => {
    for (const k of MOD_KEYS) expect(S.MOD_INFO[k].label).toBeTruthy();
  });
});
```

Create `tests/bot/command.test.js`:

```js
import { describe, expect, it } from 'vitest';

import * as S from '../../src/sim/index.js';
import { dynoCommand } from '../../bot/lib/command.js';
import { runDyno } from '../../bot/lib/dyno.js';

const STRING = 3;
const BOOLEAN = 5;
const cmd = dynoCommand();
const option = (name) => cmd.options.find((o) => o.name === name);

describe('dynoCommand', () => {
  it('is a slash command named dyno', () => {
    expect(cmd).toMatchObject({ name: 'dyno', type: 1 });
    expect(cmd.description.length).toBeGreaterThan(0);
    expect(cmd.description.length).toBeLessThanOrEqual(100);
  });

  it('requires an engine, chosen from every preset', () => {
    const engine = option('engine');
    expect(engine).toMatchObject({ type: STRING, required: true });
    expect(engine.choices).toEqual(S.ENGINE_PRESETS.map((p) => ({ name: p.name, value: p.id })));
    expect(cmd.options[0]).toBe(engine); // Discord requires required options first
  });

  it('offers the three bolt-ons as optional booleans', () => {
    for (const name of ['intake', 'exhaust', 'headers']) {
      expect(option(name)).toMatchObject({ type: BOOLEAN });
      expect(option(name).required).toBeFalsy();
    }
  });

  it('offers every pump fuel by label', () => {
    expect(option('fuel').type).toBe(STRING);
    expect(option('fuel').choices).toEqual(S.OCTANE_OPTS.map((o) => ({ name: o.label, value: o.label })));
  });

  it('stays inside Discord limits', () => {
    expect(cmd.options.length).toBeLessThanOrEqual(25);
    for (const o of cmd.options) {
      expect(o.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(o.description.length).toBeGreaterThan(0);
      expect(o.description.length).toBeLessThanOrEqual(100);
      for (const c of o.choices ?? []) {
        expect(o.choices.length).toBeLessThanOrEqual(25);
        expect(c.name.length).toBeLessThanOrEqual(100);
        expect(String(c.value).length).toBeLessThanOrEqual(100);
      }
    }
  });

  it('only offers choices that runDyno accepts', () => {
    for (const c of option('engine').choices) expect(() => runDyno({ engine: c.value })).not.toThrow();
    for (const c of option('fuel').choices) expect(() => runDyno({ engine: 'vq35hr', fuel: c.value })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run tests/bot/dyno.test.js tests/bot/command.test.js`
Expected: FAIL. The imports can't resolve.

- [ ] **Step 3: Implement `bot/lib/dyno.js`**

```js
/**
 * Turns `/dyno`'s options into two dyno pulls: the engine as it ships, and the engine with
 * whatever was changed.
 *
 * The factory tune is never touched. Parts the calibration doesn't know about show up in
 * the pull log as a mixture or MAF problem rather than as free power — that gap is what
 * ECU Lab teaches, and the bot shows it the same way the app does. The pulls come from
 * `buildRig`, the app's own assembly, never a simplified one.
 */

import { OCTANE_OPTS, buildRig, presetById } from '../../src/sim/index.js';

/** The bolt-ons `/dyno` can fit or remove, as named in a preset's `mods`. */
export const MOD_KEYS = ['intake', 'exhaust', 'headers'];

/**
 * An option the sim doesn't recognise. In practice this means the command was registered
 * against a different build of the sim than the one now deployed.
 */
export class DynoInputError extends Error {
  /**
   * @param {string} message
   * @param {unknown} value the unrecognised input
   */
  constructor(message, value) {
    super(message);
    this.name = 'DynoInputError';
    this.value = value;
  }
}

/**
 * @param {{ engine: string, intake?: boolean, exhaust?: boolean, headers?: boolean, fuel?: string }} options
 */
export function runDyno({ engine, intake, exhaust, headers, fuel }) {
  const preset = presetById(engine);
  if (!preset) throw new DynoInputError(`Unknown engine "${engine}"`, engine);

  let octaneIdx = preset.parts.octaneIdx;
  if (fuel !== undefined) {
    octaneIdx = OCTANE_OPTS.findIndex((o) => o.label === fuel);
    if (octaneIdx < 0) throw new DynoInputError(`Unknown fuel "${fuel}"`, fuel);
  }

  /** @type {Record<string, boolean | undefined>} */
  const given = { intake, exhaust, headers };
  const mods = { ...preset.mods };
  for (const k of MOD_KEYS) if (typeof given[k] === 'boolean') mods[k] = given[k];

  const isStock = octaneIdx === preset.parts.octaneIdx && MOD_KEYS.every((k) => mods[k] === preset.mods[k]);
  const stock = buildRig({ preset: preset.id }).pull();
  const modified = isStock ? stock : buildRig({ preset: preset.id, build: { mods, octaneIdx } }).pull();

  // A NaN peak would render as "NaN whp" and an empty chart. That is a sim bug, and
  // the person who hit it should be told so, not shown nonsense.
  for (const r of [stock, modified]) {
    if (!Number.isFinite(r.peakHp) || !Number.isFinite(r.peakTq)) {
      throw new Error(`The pull returned a non-finite peak (${r.peakHp} whp, ${r.peakTq} lb-ft)`);
    }
  }

  return { preset, mods, fuel: OCTANE_OPTS[octaneIdx], isStock, stock, modified };
}
```

- [ ] **Step 4: Implement `bot/lib/command.js`**

```js
/**
 * The `/dyno` command as Discord registers it.
 *
 * The choices are built from the sim's own lists, never typed out, so a preset added to
 * ENGINE_PRESETS shows up here by itself. It does still need re-registering
 * (`bot/scripts/register.js`), because Discord keeps its own copy of the choices.
 */

import { ENGINE_PRESETS, MOD_INFO, OCTANE_OPTS } from '../../src/sim/index.js';
import { MOD_KEYS } from './dyno.js';

// Discord's application-command option types.
const STRING = 3;
const BOOLEAN = 5;
// A CHAT_INPUT command: one typed with a slash.
const CHAT_INPUT = 1;

/** @returns {object} the command definition, as Discord's API takes it */
export function dynoCommand() {
  return {
    name: 'dyno',
    type: CHAT_INPUT,
    description: 'Full-throttle dyno pull of a factory engine, on its factory tune',
    options: [
      {
        type: STRING,
        name: 'engine',
        description: 'Which factory engine',
        required: true,
        choices: ENGINE_PRESETS.map((p) => ({ name: p.name, value: p.id })),
      },
      ...MOD_KEYS.map((k) => ({
        type: BOOLEAN,
        name: k,
        description: `Fit or remove the ${MOD_INFO[k].label} (default: as the engine ships)`,
      })),
      {
        type: STRING,
        name: 'fuel',
        description: "Fuel in the tank (default: the engine's own)",
        choices: OCTANE_OPTS.map((o) => ({ name: o.label, value: o.label })),
      },
    ],
  };
}
```

- [ ] **Step 5: Run the tests, lint and typecheck**

Run: `npx vitest run tests/bot/dyno.test.js tests/bot/command.test.js && npm run lint && npm run typecheck`
Expected: all pass; lint and typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add bot/lib/dyno.js bot/lib/command.js tests/bot/dyno.test.js tests/bot/command.test.js
git commit -m "Add /dyno's command definition and its options-to-pulls step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The chart as SVG

**Files:**
- Create: `bot/lib/chart.js`
- Test: `tests/bot/chart.test.js`

**Interfaces:**
- Consumes: pull results (`points[].rpm/hp/torque`), `tokens` from `src/ui/tokens.js` and `SWEEP_START_RPM` from `src/sim/index.js`.
- Produces:
  - `CHART_WIDTH = 1000` and `CHART_HEIGHT = 560`.
  - `escapeXml(text): string`.
  - `dynoChartSvg({ stock, modified, title }): string`. The stock overlay is drawn only when `stock !== modified`.

- [ ] **Step 1: Write the failing test**

Create `tests/bot/chart.test.js`:

```js
// @vitest-environment jsdom
/**
 * The chart's SVG is checked as a document (jsdom's parser), not as a string, so a
 * structural mistake fails here rather than as a blank image in Discord.
 */

import { describe, expect, it } from 'vitest';

import { tokens } from '../../src/ui/tokens.js';
import { runDyno } from '../../bot/lib/dyno.js';
import { CHART_HEIGHT, CHART_WIDTH, dynoChartSvg, escapeXml } from '../../bot/lib/chart.js';

// Through `window`, which the lint config already knows; DOMParser itself isn't a declared global.
const parse = (svg) => new window.DOMParser().parseFromString(svg, 'image/svg+xml');
const stockRun = runDyno({ engine: 'vq35hr' });
const moddedRun = runDyno({ engine: 'vq35hr', intake: true, headers: true });

describe('dynoChartSvg', () => {
  it('is a well-formed SVG of the agreed size', () => {
    const doc = parse(dynoChartSvg({ stock: stockRun.stock, modified: stockRun.modified, title: 'T' }));
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    const root = doc.documentElement;
    expect(root.tagName).toBe('svg');
    expect(root.getAttribute('width')).toBe(String(CHART_WIDTH));
    expect(root.getAttribute('height')).toBe(String(CHART_HEIGHT));
  });

  it('draws power and torque, and no stock overlay for a stock pull', () => {
    const doc = parse(dynoChartSvg({ stock: stockRun.stock, modified: stockRun.modified, title: 'T' }));
    expect(doc.querySelector('[data-series="hp"]')).not.toBeNull();
    expect(doc.querySelector('[data-series="torque"]')).not.toBeNull();
    expect(doc.querySelector('[data-series="stock-hp"]')).toBeNull();
    expect(doc.querySelector('[data-series="stock-torque"]')).toBeNull();
  });

  it('overlays the stock curves, dashed, when the build differs', () => {
    const doc = parse(dynoChartSvg({ stock: moddedRun.stock, modified: moddedRun.modified, title: 'T' }));
    for (const s of ['stock-hp', 'stock-torque']) {
      const line = doc.querySelector(`[data-series="${s}"]`);
      expect(line).not.toBeNull();
      expect(line.getAttribute('stroke-dasharray')).toBe('5 4');
    }
  });

  it('plots one vertex per point of the pull', () => {
    const doc = parse(dynoChartSvg({ stock: stockRun.stock, modified: stockRun.modified, title: 'T' }));
    const d = doc.querySelector('[data-series="hp"]').getAttribute('d');
    expect(d.match(/[ML]/g)).toHaveLength(stockRun.modified.points.length);
  });

  it('escapes the title', () => {
    const svg = dynoChartSvg({ stock: stockRun.stock, modified: stockRun.modified, title: 'A <b> & "c"' });
    expect(parse(svg).getElementsByTagName('parsererror')).toHaveLength(0);
    expect(svg).toContain('A &lt;b&gt; &amp; &quot;c&quot;');
  });

  it('uses only the app\'s token colours', () => {
    const svg = dynoChartSvg({ stock: moddedRun.stock, modified: moddedRun.modified, title: 'T' });
    const allowed = new Set(Object.values(tokens).filter((v) => typeof v === 'string').map((v) => v.toLowerCase()));
    for (const hex of svg.match(/#[0-9a-f]{3,8}\b/gi) ?? []) expect(allowed).toContain(hex.toLowerCase());
  });

  it('names its font, since resvg sees only the bundled one', () => {
    const svg = dynoChartSvg({ stock: stockRun.stock, modified: stockRun.modified, title: 'T' });
    expect(svg).toContain('font-family="Roboto"');
  });
});

describe('escapeXml', () => {
  it('escapes the five XML specials', () => {
    expect(escapeXml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&apos;');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/bot/chart.test.js`
Expected: FAIL. The import can't resolve `bot/lib/chart.js`.

- [ ] **Step 3: Implement `bot/lib/chart.js`**

```js
/**
 * The dyno chart for a `/dyno` reply, as SVG.
 *
 * It mirrors DYNO's result chart (src/ui/screens/dyno/ResultScreen.jsx), so a tester sees
 * the same picture in Discord as in the app:
 * - power in `acc` and torque in `cyan`, 2 px wide, on one shared axis
 * - the stock curves in the same colours, dashed `5 4` at half opacity, drawn only when the
 *   build differs from stock
 *
 * Colours come from the app's tokens, never retyped, so a palette change reaches the bot
 * too. Text names Roboto only: the PNG renderer (bot/render.js) loads just the bundled
 * font, and any other family would draw nothing.
 */

import { SWEEP_START_RPM } from '../../src/sim/index.js';
import { tokens } from '../../src/ui/tokens.js';

export const CHART_WIDTH = 1000;
export const CHART_HEIGHT = 560;

const PAD = { left: 64, right: 24, top: 56, bottom: 76 };
const FONT = 'font-family="Roboto"';
// Candidate y-axis steps, smallest first. The first that gives at most 8 gridlines wins.
const Y_STEPS = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
const X_STEP_RPM = 1000;

/** @param {unknown} text */
export function escapeXml(text) {
  /** @type {Record<string, string>} */
  const map = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };
  return String(text).replace(/[<>&"']/g, (c) => map[c]);
}

/**
 * @param {{ stock: {points: object[]}, modified: {points: object[]}, title: string }} input
 * @returns {string}
 */
export function dynoChartSvg({ stock, modified, title }) {
  const showStock = stock !== modified;
  const pulls = showStock ? [stock, modified] : [modified];
  /** @param {{points: any[]}} pull */
  const plotted = (pull) => pull.points.filter((p) => Number.isFinite(p.hp) && Number.isFinite(p.torque));
  const all = pulls.flatMap(plotted);

  const xMin = SWEEP_START_RPM;
  const xMax = Math.max(xMin + X_STEP_RPM, ...all.map((p) => p.rpm));
  const yPeak = Math.max(1, ...all.flatMap((p) => [p.hp, p.torque]));
  const yStep = Y_STEPS.find((s) => (yPeak * 1.05) / s <= 8) ?? Y_STEPS[Y_STEPS.length - 1];
  const yMax = Math.ceil((yPeak * 1.05) / yStep) * yStep;

  const w = CHART_WIDTH - PAD.left - PAD.right;
  const h = CHART_HEIGHT - PAD.top - PAD.bottom;
  /** @param {number} rpm */
  const x = (rpm) => PAD.left + ((rpm - xMin) / (xMax - xMin)) * w;
  /** @param {number} v */
  const y = (v) => PAD.top + h - (v / yMax) * h;
  /** @param {any[]} points @param {'hp' | 'torque'} key */
  const path = (points, key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.rpm).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');

  const parts = [];
  parts.push(`<rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="${tokens.bg}"/>`);
  parts.push(`<text x="${PAD.left}" y="34" ${FONT} font-size="20" fill="${tokens.ink}">${escapeXml(title)}</text>`);

  for (let v = 0; v <= yMax; v += yStep) {
    parts.push(`<line x1="${PAD.left}" x2="${PAD.left + w}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${tokens.line}"/>`);
    parts.push(`<text x="${PAD.left - 8}" y="${(y(v) + 4).toFixed(1)}" ${FONT} font-size="12" fill="${tokens.ink2}" text-anchor="end">${v}</text>`);
  }
  for (let rpm = Math.ceil(xMin / X_STEP_RPM) * X_STEP_RPM; rpm <= xMax; rpm += X_STEP_RPM) {
    parts.push(`<line x1="${x(rpm).toFixed(1)}" x2="${x(rpm).toFixed(1)}" y1="${PAD.top}" y2="${PAD.top + h}" stroke="${tokens.line}"/>`);
    parts.push(`<text x="${x(rpm).toFixed(1)}" y="${PAD.top + h + 18}" ${FONT} font-size="12" fill="${tokens.ink2}" text-anchor="middle">${rpm}</text>`);
  }
  parts.push(`<text x="${PAD.left + w / 2}" y="${PAD.top + h + 38}" ${FONT} font-size="12" fill="${tokens.ink2}" text-anchor="middle">RPM</text>`);

  const series = [];
  if (showStock) {
    series.push({ id: 'stock-hp', points: plotted(stock), key: 'hp', colour: tokens.acc, label: 'Stock WHP', dashed: true });
    series.push({ id: 'stock-torque', points: plotted(stock), key: 'torque', colour: tokens.cyan, label: 'Stock TQ', dashed: true });
  }
  series.push({ id: 'hp', points: plotted(modified), key: 'hp', colour: tokens.acc, label: 'WHP', dashed: false });
  series.push({ id: 'torque', points: plotted(modified), key: 'torque', colour: tokens.cyan, label: 'Torque', dashed: false });

  for (const s of series) {
    const style = s.dashed ? 'stroke-width="1.5" stroke-dasharray="5 4" opacity="0.5"' : 'stroke-width="2"';
    parts.push(`<path data-series="${s.id}" d="${path(s.points, /** @type {'hp' | 'torque'} */ (s.key))}" fill="none" stroke="${s.colour}" ${style}/>`);
  }

  // Legend along the bottom, in drawing order with the measured build last.
  let lx = PAD.left;
  const ly = CHART_HEIGHT - 16;
  for (const s of series) {
    const dash = s.dashed ? ' stroke-dasharray="5 4" opacity="0.5"' : '';
    parts.push(`<line x1="${lx}" x2="${lx + 22}" y1="${ly - 4}" y2="${ly - 4}" stroke="${s.colour}" stroke-width="2"${dash}/>`);
    parts.push(`<text x="${lx + 28}" y="${ly}" ${FONT} font-size="12" fill="${tokens.ink2}">${escapeXml(s.label)}</text>`);
    lx += 40 + s.label.length * 7;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">${parts.join('')}</svg>`;
}
```

- [ ] **Step 4: Run the test, lint and typecheck**

Run: `npx vitest run tests/bot/chart.test.js && npm run lint && npm run typecheck`
Expected: 8 tests pass; lint and typecheck clean. If the token-colour test fails because a token value is in a different case or form, fix the test's normalisation. Never add a hex literal to `chart.js`.

- [ ] **Step 5: Commit**

```bash
git add bot/lib/chart.js tests/bot/chart.test.js
git commit -m "Draw /dyno's power and torque chart as SVG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The reply

**Files:**
- Create: `bot/lib/reply.js`
- Test: `tests/bot/reply.test.js`

**Interfaces:**
- Consumes:
  - `runDyno`'s result (Task 3)
  - `buildPayload` from `scripts/discord-notify.js`, which returns `{ embeds: [embed] }` and enforces Discord's limits
  - `tokens`, `MOD_INFO` and `OCTANE_OPTS`
- Produces:
  - `MAX_EVENTS = 3`.
  - `signed(n): string`, giving `+1`, `−3` (a U+2212 minus) or `±0`.
  - `replyTitle({ preset, mods, fuel }): string`.
  - `footerText(sha?): string`.
  - `dynoReply({ preset, mods, fuel, isStock, stock, modified, sha, chart }): object`. `chart` is a boolean: whether a PNG is attached.
  - `problemReply({ title, description, sha }): object`.
  - Both replies return a Discord message body: `{ embeds, attachments, allowed_mentions }`.

- [ ] **Step 1: Write the failing test**

Create `tests/bot/reply.test.js`:

```js
import { describe, expect, it } from 'vitest';

import * as S from '../../src/sim/index.js';
import { tokens } from '../../src/ui/tokens.js';
import { runDyno } from '../../bot/lib/dyno.js';
import { MAX_EVENTS, dynoReply, footerText, problemReply, replyTitle, signed } from '../../bot/lib/reply.js';

const colour = (hex) => parseInt(hex.slice(1), 16);
const SHA = '27db48c0123456789abcdef0123456789abcdef0';

/** A pull result with only what the reply reads. */
const pull = (peakHp, peakTq, events = []) => ({ peakHp, peakTq, events, points: [] });
const ev = (severity, msg) => ({ type: 'x', severity, impact: 1, rpmStart: 0, rpmEnd: 0, msg, cause: 'c', fix: 'f' });

describe('signed', () => {
  it('signs whole-number differences', () => {
    expect(signed(1.4)).toBe('+1');
    expect(signed(-3)).toBe('−3');
    expect(signed(0.2)).toBe('±0');
  });
});

describe('replyTitle', () => {
  const preset = S.presetById('vq35hr');
  const ownFuel = S.OCTANE_OPTS[preset.parts.octaneIdx];

  it('says stock when nothing changed', () => {
    expect(replyTitle({ preset, mods: preset.mods, fuel: ownFuel })).toBe('Nissan VQ35HR · stock · factory tune');
  });

  it('names fitted bolt-ons and a changed fuel', () => {
    const mods = { ...preset.mods, intake: true, headers: true };
    const e85 = S.OCTANE_OPTS.find((o) => o.label === 'E85');
    expect(replyTitle({ preset, mods, fuel: e85 }))
      .toBe(`Nissan VQ35HR · ${S.MOD_INFO.intake.label} + ${S.MOD_INFO.headers.label} + E85 · factory tune`);
  });
});

describe('footerText', () => {
  it('names the unreleased main commit, or a local build', () => {
    expect(footerText(SHA)).toBe('main @ 27db48c (unreleased) · ECU Lab sim');
    expect(footerText(undefined)).toBe('local build · ECU Lab sim');
  });
});

describe('dynoReply', () => {
  const preset = S.presetById('vq35hr');
  const base = { preset, mods: preset.mods, fuel: S.OCTANE_OPTS[preset.parts.octaneIdx], sha: SHA, chart: true };

  it('gives a stock pull its peaks, no differences, and a clean bill', () => {
    const p = pull(259.6, 232.2);
    const msg = dynoReply({ ...base, isStock: true, stock: p, modified: p });
    const embed = msg.embeds[0];
    expect(embed.description.split('\n')[0]).toBe('**260 whp** · **232 lb-ft**');
    expect(embed.description).toContain('Clean pull, no warnings.');
    expect(embed.color).toBe(colour(tokens.ok));
    expect(embed.footer.text).toBe(footerText(SHA));
    expect(embed.image).toEqual({ url: 'attachment://dyno.png' });
    expect(msg.attachments).toEqual([{ id: 0, filename: 'dyno.png' }]);
    expect(msg.allowed_mentions).toEqual({ parse: [] });
  });

  it('shows differences from the rounded stock peaks', () => {
    const msg = dynoReply({ ...base, isStock: false, stock: pull(259.6, 232.4), modified: pull(260.6, 236.9) });
    expect(msg.embeds[0].description.split('\n')[0]).toBe('**261 whp** (+1 vs stock) · **237 lb-ft** (+5)');
  });

  it('lists the worst events first, up to three, then counts the rest', () => {
    const events = [ev(1, 'rich'), ev(2, 'lean'), ev(3, 'knock'), ev(2, 'duty'), ev(1, 'trim')];
    const msg = dynoReply({ ...base, isStock: false, stock: pull(1, 1), modified: pull(1, 1, events) });
    const lines = msg.embeds[0].description.split('\n').slice(1);
    expect(lines).toEqual(['🛑 knock', '⚠️ lean', '⚠️ duty', `…and ${events.length - MAX_EVENTS} more in the app`]);
    expect(msg.embeds[0].color).toBe(colour(tokens.danger));
  });

  it('colours a warning-only pull amber', () => {
    const msg = dynoReply({ ...base, isStock: false, stock: pull(1, 1), modified: pull(1, 1, [ev(2, 'lean')]) });
    expect(msg.embeds[0].color).toBe(colour(tokens.warn));
  });

  it('says so, and attaches nothing, when the chart could not be drawn', () => {
    const p = pull(1, 1);
    const msg = dynoReply({ ...base, isStock: true, stock: p, modified: p, chart: false });
    expect(msg.embeds[0].image).toBeUndefined();
    expect(msg.attachments).toEqual([]);
    expect(msg.embeds[0].description).toContain("chart couldn't be drawn");
  });

  it('stays inside Discord limits however long the log gets', () => {
    const events = Array.from({ length: 50 }, (_, i) => ev(2, 'x'.repeat(2000) + i));
    const msg = dynoReply({ ...base, isStock: false, stock: pull(1, 1), modified: pull(1, 1, events) });
    expect(msg.embeds[0].description.length).toBeLessThanOrEqual(4096);
  });

  it('works on a real pull', () => {
    const r = runDyno({ engine: 'vq35hr', intake: true, headers: true });
    const msg = dynoReply({ ...r, sha: SHA, chart: true });
    expect(msg.embeds[0].title).toBe(replyTitle(r));
    expect(msg.embeds[0].description).toMatch(/^\*\*\d+ whp\*\* \([+−±]\d+ vs stock\)/);
  });
});

describe('problemReply', () => {
  it('is a red embed with the footer and no attachment', () => {
    const msg = problemReply({ title: 'The pull crashed', description: 'Report it.', sha: SHA });
    expect(msg.embeds[0]).toMatchObject({ title: 'The pull crashed', description: 'Report it.', color: colour(tokens.danger) });
    expect(msg.embeds[0].footer.text).toBe(footerText(SHA));
    expect(msg.attachments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/bot/reply.test.js`
Expected: FAIL. The import can't resolve `bot/lib/reply.js`.

- [ ] **Step 3: Implement `bot/lib/reply.js`**

```js
/**
 * The Discord messages `/dyno` replies with.
 *
 * A reply leads with the two peaks and how they moved against stock, then the pull log's
 * worst warnings: that pairing is the lesson. Bolting parts onto a factory tune buys
 * little and costs a mixture problem, and the reply should show both in one glance. Each
 * warning's `cause` and `fix` stay in the app; a chat message is for noticing, the app is
 * for understanding.
 *
 * Embeds go through `buildPayload` from scripts/discord-notify.js, so Discord's length
 * limits are enforced by the same code the workflows use.
 */

import { MOD_INFO, OCTANE_OPTS } from '../../src/sim/index.js';
import { tokens } from '../../src/ui/tokens.js';
import { buildPayload } from '../../scripts/discord-notify.js';
import { MOD_KEYS } from './dyno.js';

/** How many pull-log events a reply lists before counting the rest. */
export const MAX_EVENTS = 3;

/** A token's `#rrggbb` as the integer Discord wants. */
const embedColour = (/** @type {string} */ hex) => parseInt(hex.slice(1), 16);

/**
 * A whole-number difference with its sign. A real minus sign (U+2212), as a printed
 * dyno sheet would have it, and ±0 for no change.
 * @param {number} n
 */
export function signed(n) {
  const r = Math.round(n);
  if (r > 0) return `+${r}`;
  if (r < 0) return `−${-r}`;
  return '±0';
}

/**
 * `<engine> · <what changed> · factory tune`.
 * @param {{ preset: any, mods: Record<string, boolean>, fuel: { label: string } }} run
 */
export function replyTitle({ preset, mods, fuel }) {
  const changes = [];
  for (const k of MOD_KEYS) {
    if (mods[k] && !preset.mods[k]) changes.push(MOD_INFO[k].label);
    if (!mods[k] && preset.mods[k]) changes.push(`no ${MOD_INFO[k].label}`);
  }
  if (fuel.label !== OCTANE_OPTS[preset.parts.octaneIdx].label) changes.push(fuel.label);
  return `${preset.name} · ${changes.length ? changes.join(' + ') : 'stock'} · factory tune`;
}

/**
 * Which sim answered. On `main`, BUILD_VERSION still names the last release, so the
 * commit is the only honest build id for a tester's bug report.
 * @param {string} [sha]
 */
export function footerText(sha) {
  return sha ? `main @ ${sha.slice(0, 7)} (unreleased) · ECU Lab sim` : 'local build · ECU Lab sim';
}

/**
 * Events worst first; equal severities keep the order the sim logged them.
 * @param {{ severity: number }[]} events
 */
function worstFirst(events) {
  return events.map((e, i) => ({ e, i })).sort((a, b) => (b.e.severity - a.e.severity) || (a.i - b.i)).map(({ e }) => e);
}

/**
 * The reply to a pull that ran.
 * @param {{ preset: any, mods: Record<string, boolean>, fuel: { label: string }, isStock: boolean,
 *   stock: { peakHp: number, peakTq: number }, modified: { peakHp: number, peakTq: number, events: any[] },
 *   sha?: string, chart: boolean }} run
 */
export function dynoReply({ preset, mods, fuel, isStock, stock, modified, sha, chart }) {
  const hp = Math.round(modified.peakHp);
  const tq = Math.round(modified.peakTq);
  // Differences are taken between the rounded figures, so they always agree with the
  // numbers printed next to them.
  const lines = [isStock
    ? `**${hp} whp** · **${tq} lb-ft**`
    : `**${hp} whp** (${signed(hp - Math.round(stock.peakHp))} vs stock) · **${tq} lb-ft** (${signed(tq - Math.round(stock.peakTq))})`];

  const events = worstFirst(modified.events);
  if (events.length === 0) lines.push('Clean pull, no warnings.');
  for (const e of events.slice(0, MAX_EVENTS)) lines.push(`${e.severity >= 3 ? '🛑' : '⚠️'} ${e.msg}`);
  if (events.length > MAX_EVENTS) lines.push(`…and ${events.length - MAX_EVENTS} more in the app`);
  if (!chart) lines.push("_The chart couldn't be drawn this time._");

  const worst = Math.max(0, ...modified.events.map((e) => e.severity));
  const colour = worst >= 3 ? tokens.danger : worst >= 1 ? tokens.warn : tokens.ok;

  const { embeds: [embed] } = buildPayload({
    title: replyTitle({ preset, mods, fuel }),
    description: lines.join('\n'),
    color: embedColour(colour),
    footer: footerText(sha),
  });
  if (chart) embed.image = { url: 'attachment://dyno.png' };
  return {
    embeds: [embed],
    attachments: chart ? [{ id: 0, filename: 'dyno.png' }] : [],
    // Nothing in a reply should ever ping anyone, whatever text a pull log contains.
    allowed_mentions: { parse: [] },
  };
}

/**
 * The reply when there is no pull to show: a bad option or a crash.
 * @param {{ title: string, description: string, sha?: string }} problem
 */
export function problemReply({ title, description, sha }) {
  const { embeds } = buildPayload({ title, description, color: embedColour(tokens.danger), footer: footerText(sha) });
  return { embeds, attachments: [], allowed_mentions: { parse: [] } };
}
```

- [ ] **Step 4: Run the test, lint and typecheck**

Run: `npx vitest run tests/bot/reply.test.js && npm run lint && npm run typecheck`
Expected: all pass; lint and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add bot/lib/reply.js tests/bot/reply.test.js
git commit -m "Build /dyno's reply: peaks against stock, worst warnings first

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The request handler

**Files:**
- Create: `bot/lib/handler.js`
- Test: `tests/bot/handler.test.js`

**Interfaces:**
- Consumes: `verifyDiscordRequest` (Task 2), `runDyno` and `DynoInputError` (Task 3), `dynoChartSvg` (Task 4), and `dynoReply`, `problemReply` and `replyTitle` (Task 5).
- Produces:
  - `DISCORD_API = 'https://discord.com/api/v10'`.
  - `optionsOf(interaction): Record<string, unknown>`.
  - `createHandler({ publicKey, waitUntil, render, fetch, sha, log?, dyno? }): (request: Request) => Promise<Response>`:
    - `render(svg)` returns PNG bytes (`Uint8Array`), sync or async.
    - `log` defaults to `console`.
    - `dyno` defaults to `runDyno`; it's a seam for the crash test.

- [ ] **Step 1: Write the failing test**

Create `tests/bot/handler.test.js`:

```js
/**
 * The endpoint, driven as Discord drives it: signed requests in, a deferred reply out,
 * then an edit to that reply. `fetch`, `waitUntil` and the PNG renderer are stubs, so
 * nothing leaves the machine and resvg is never loaded.
 */

import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { DISCORD_API, createHandler } from '../../bot/lib/handler.js';
import { DynoInputError } from '../../bot/lib/dyno.js';

const { publicKey: pub, privateKey } = generateKeyPairSync('ed25519');
const publicKey = Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url').toString('hex');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function signedRequest(payload, { tamper = false } = {}) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
  return new Request('https://bot.example/api/interactions', {
    method: 'POST',
    headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp, 'content-type': 'application/json' },
    body: tamper ? body.replace('}', ',"x":1}') : body,
  });
}

const dynoInteraction = (options) => ({
  type: 2, application_id: 'APP', token: 'TOKEN-SECRET',
  data: { name: 'dyno', options: Object.entries(options).map(([name, value]) => ({ name, value })) },
});

function setup(overrides = {}) {
  const pending = [];
  // Parameters named so the mock's recorded calls are typed as [url, init].
  const fetch = vi.fn(async (_url, _init) => new Response('{}', { status: 200 }));
  const log = { error: vi.fn(), warn: vi.fn() };
  const handle = createHandler({
    publicKey, waitUntil: (p) => pending.push(p), render: () => PNG, fetch, sha: 'abcdef0123', log, ...overrides,
  });
  return { handle, fetch, log, settle: () => Promise.all(pending) };
}

describe('createHandler', () => {
  it('answers Discord\'s PING with a PONG', async () => {
    const { handle } = setup();
    const res = await handle(signedRequest({ type: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it('rejects an unsigned or tampered request with 401', async () => {
    const { handle } = setup();
    expect((await handle(new Request('https://x/', { method: 'POST', body: '{"type":1}' }))).status).toBe(401);
    expect((await handle(signedRequest({ type: 1 }, { tamper: true }))).status).toBe(401);
  });

  it('defers /dyno, then edits the reply with the chart attached', async () => {
    const { handle, fetch, settle } = setup();
    const res = await handle(signedRequest(dynoInteraction({ engine: 'vq35hr', intake: true })));
    expect(await res.json()).toEqual({ type: 5 });
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${DISCORD_API}/webhooks/APP/TOKEN-SECRET/messages/@original`);
    expect(init.method).toBe('PATCH');
    expect(init.body).toBeInstanceOf(FormData);
    const payload = JSON.parse(init.body.get('payload_json'));
    expect(payload.embeds[0].title).toContain('Nissan VQ35HR');
    expect(payload.embeds[0].footer.text).toContain('main @ abcdef0');
    expect(payload.attachments).toEqual([{ id: 0, filename: 'dyno.png' }]);
    const file = init.body.get('files[0]');
    expect(file.type).toBe('image/png');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
  });

  it('still replies, without the image, when the chart fails to render', async () => {
    const { handle, fetch, log, settle } = setup({ render: () => { throw new Error('resvg broke'); } });
    await handle(signedRequest(dynoInteraction({ engine: 'vq35hr' })));
    await settle();
    const [, init] = fetch.mock.calls[0];
    const payload = JSON.parse(init.body);
    expect(payload.attachments).toEqual([]);
    expect(payload.embeds[0].description).toContain("chart couldn't be drawn");
    expect(log.error).toHaveBeenCalled();
  });

  it('explains an option the sim does not know', async () => {
    const { handle, fetch, log, settle } = setup();
    await handle(signedRequest(dynoInteraction({ engine: 'sr20det' })));
    await settle();
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.embeds[0].description).toContain('re-register');
    expect(log.warn).toHaveBeenCalled();
  });

  it('reports a crashed pull as a bug, with the build line', async () => {
    const dyno = () => { throw new Error('NaN everywhere'); };
    const { handle, fetch, log, settle } = setup({ dyno });
    await handle(signedRequest(dynoInteraction({ engine: 'vq35hr' })));
    await settle();
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.embeds[0].title).toBe('The pull crashed');
    expect(payload.embeds[0].footer.text).toContain('main @ abcdef0');
    expect(log.error).toHaveBeenCalled();
  });

  it('logs a refused edit without ever logging the token', async () => {
    const fetch = vi.fn(async (_url, _init) => new Response('nope', { status: 404 }));
    const { handle, log, settle } = setup({ fetch });
    await handle(signedRequest(dynoInteraction({ engine: 'vq35hr' })));
    await settle();
    const logged = JSON.stringify(log.error.mock.calls);
    expect(logged).toContain('404');
    expect(logged).not.toContain('TOKEN-SECRET');
  });

  it('turns away any other command, privately', async () => {
    const { handle } = setup();
    const res = await handle(signedRequest({ type: 2, application_id: 'APP', token: 'T', data: { name: 'other' } }));
    expect(await res.json()).toEqual({ type: 4, data: { content: 'Unknown command.', flags: 64 } });
  });

  it('accepts a DynoInputError from a custom pull too', async () => {
    const dyno = () => { throw new DynoInputError('Unknown fuel "x"', 'x'); };
    const { handle, fetch, settle } = setup({ dyno });
    await handle(signedRequest(dynoInteraction({ engine: 'vq35hr' })));
    await settle();
    expect(JSON.parse(fetch.mock.calls[0][1].body).embeds[0].description).toContain('re-register');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/bot/handler.test.js`
Expected: FAIL. The import can't resolve `bot/lib/handler.js`.

- [ ] **Step 3: Implement `bot/lib/handler.js`**

```js
/**
 * The `/dyno` endpoint's logic, with its runtime passed in.
 *
 * Discord must hear back within 3 seconds. Two pulls and a chart take about a second, but
 * a cold start can eat the rest, so `/dyno` is answered at once with a deferred reply
 * ("ECU Lab Dyno is thinking…") and the work carries on under `waitUntil`, ending in an
 * edit to that reply. Discord allows 15 minutes for the edit.
 *
 * Everything that touches the outside world comes in as a parameter: `waitUntil` (Vercel's),
 * `render` (resvg, in bot/render.js), `fetch`, `log`. That keeps this file free of the bot's
 * own dependencies, so the root test suite can drive it with stubs.
 *
 * The interaction token in the edit URL is a credential for that one reply. It is never
 * logged.
 */

import { dynoChartSvg } from './chart.js';
import { DynoInputError, runDyno } from './dyno.js';
import { dynoReply, problemReply, replyTitle } from './reply.js';
import { verifyDiscordRequest } from './verify.js';

export const DISCORD_API = 'https://discord.com/api/v10';

// Interaction types Discord sends, and response types it accepts.
const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const DEFERRED_CHANNEL_MESSAGE = 5;
const EPHEMERAL = 64;

/** @param {object} body @param {number} [status] */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * A command's options as `{ name: value }`.
 * @param {{ data?: { options?: { name: string, value: unknown }[] } }} interaction
 */
export function optionsOf(interaction) {
  return Object.fromEntries((interaction.data?.options ?? []).map((o) => [o.name, o.value]));
}

/**
 * @param {{
 *   publicKey: string | undefined,
 *   waitUntil: (p: Promise<unknown>) => void,
 *   render: (svg: string) => Uint8Array | Promise<Uint8Array>,
 *   fetch: typeof globalThis.fetch,
 *   sha?: string,
 *   log?: { error: (...a: any[]) => void, warn: (...a: any[]) => void },
 *   dyno?: typeof runDyno,
 * }} runtime
 * @returns {(request: Request) => Promise<Response>}
 */
export function createHandler({ publicKey, waitUntil, render, fetch, sha, log = console, dyno = runDyno }) {
  return async function handle(request) {
    const body = await request.text();
    const authentic = verifyDiscordRequest({
      publicKey,
      signature: request.headers.get('x-signature-ed25519'),
      timestamp: request.headers.get('x-signature-timestamp'),
      body,
    });
    if (!authentic) return new Response('invalid request signature', { status: 401 });

    let interaction;
    try {
      interaction = JSON.parse(body);
    } catch {
      return new Response('bad request', { status: 400 });
    }

    if (interaction.type === PING) return json({ type: PONG });
    if (interaction.type === APPLICATION_COMMAND && interaction.data?.name === 'dyno') {
      waitUntil(completeDyno({ interaction, render, fetch, sha, log, dyno }));
      return json({ type: DEFERRED_CHANNEL_MESSAGE });
    }
    return json({ type: CHANNEL_MESSAGE, data: { content: 'Unknown command.', flags: EPHEMERAL } });
  };
}

/**
 * Runs the pulls, draws the chart and edits the deferred reply. Never throws: whatever
 * goes wrong ends as a reply the tester can read, or a log line if Discord itself can't
 * be reached.
 */
async function completeDyno({ interaction, render, fetch, sha, log, dyno }) {
  const options = optionsOf(interaction);
  let message;
  let png = null;
  try {
    const run = dyno(/** @type {any} */ (options));
    try {
      png = await render(dynoChartSvg({ stock: run.stock, modified: run.modified, title: replyTitle(run) }));
    } catch (err) {
      log.error('dyno: the chart failed to render', err);
    }
    message = dynoReply({ ...run, sha, chart: png !== null });
  } catch (err) {
    if (err instanceof DynoInputError) {
      log.warn(`dyno: ${err.message}`);
      message = problemReply({
        title: "That option isn't in this build",
        description: `${err.message}. The sim on this build doesn't have it, so the command needs to re-register (bot/scripts/register.js).`,
        sha,
      });
    } else {
      log.error('dyno: the pull failed', JSON.stringify(options), err);
      message = problemReply({
        title: 'The pull crashed',
        description: "That's a bug in the sim. Please report it with the line below, and the options you used.",
        sha,
      });
    }
  }
  await editReply({ interaction, message, png, fetch, log });
}

/** PATCHes the deferred reply. Multipart when there's a PNG to attach, JSON otherwise. */
async function editReply({ interaction, message, png, fetch, log }) {
  const url = `${DISCORD_API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
  /** @type {RequestInit} */
  let init;
  if (png) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(message));
    form.append('files[0]', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'dyno.png');
    init = { method: 'PATCH', body: form };
  } else {
    init = { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message) };
  }
  const redact = (/** @type {unknown} */ text) => String(text).split(interaction.token).join('[token]');
  try {
    const res = await fetch(url, init);
    if (!res.ok) log.error(`dyno: Discord refused the edit (${res.status}): ${redact(await res.text())}`);
  } catch (err) {
    log.error(`dyno: could not reach Discord: ${redact(err?.message ?? err)}`);
  }
}
```

- [ ] **Step 4: Run the test, lint and typecheck**

Run: `npx vitest run tests/bot/handler.test.js && npm run lint && npm run typecheck`
Expected: 9 tests pass; lint and typecheck clean. If typecheck objects to the `Blob` part type or to `RequestInit`, fix it with a JSDoc cast at that line. Don't loosen `tsconfig.json`.

- [ ] **Step 5: Commit**

```bash
git add bot/lib/handler.js tests/bot/handler.test.js
git commit -m "Add /dyno's request handler: verify, defer, pull, edit the reply

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The runtime, deploy files, scripts and docs

**Files:**
- Create: `bot/package.json`, `bot/package-lock.json` (generated)
- Create: `bot/render.js`, `bot/api/interactions.js`, `bot/vercel.json`
- Create: `bot/scripts/should-build.sh`, `bot/scripts/register.js`, `bot/scripts/preview.js`
- Create: `bot/fonts/Roboto-Regular.ttf`, `bot/fonts/LICENSE`, `bot/.gitignore`
- Create: `bot/README.md`
- Modify: `eslint.config.js` (`ignores`), `tsconfig.json` (`include`), `CLAUDE.md`
- Test: `tests/bot/should-build.test.js`

**Interfaces:**
- Consumes: `createHandler` (Task 6), `dynoCommand` (Task 3), `runDyno` (Task 3), `dynoChartSvg` and `CHART_WIDTH` (Task 4), and `replyTitle` (Task 5).
- Produces:
  - `svgToPng(svg: string): Uint8Array` in `bot/render.js`.
  - The Vercel function `POST` in `bot/api/interactions.js`.

- [ ] **Step 1: Write the failing test for the ignore step**

Create `tests/bot/should-build.test.js`:

```js
/**
 * Vercel runs bot/scripts/should-build.sh before every build: exit 0 skips, exit 1
 * builds. It must skip everything but `main`, so no branch or pull request (forks
 * included) gets a live bot, and on `main` build only when something the bot runs changed.
 * Each case builds a throwaway repo with the real script in it.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../bot/scripts/should-build.sh', import.meta.url));
let dir;

function git(...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
}

/** A repo with one commit holding the bot and the files it depends on. */
function repo() {
  dir = mkdtempSync(join(tmpdir(), 'should-build-'));
  for (const d of ['bot/scripts', 'src/sim', 'src/ui', 'scripts']) mkdirSync(join(dir, d), { recursive: true });
  copyFileSync(SCRIPT, join(dir, 'bot/scripts/should-build.sh'));
  for (const f of ['bot/a.js', 'src/sim/x.js', 'src/ui/tokens.js', 'src/ui/other.js', 'scripts/discord-notify.js', 'README.md']) {
    writeFileSync(join(dir, f), '1\n');
  }
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
}

function change(file) {
  writeFileSync(join(dir, file), '2\n');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', `change ${file}`);
}

function run(ref) {
  return spawnSync('bash', ['scripts/should-build.sh'], {
    cwd: join(dir, 'bot'), encoding: 'utf8', env: { ...process.env, VERCEL_GIT_COMMIT_REF: ref },
  }).status;
}

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('should-build.sh', () => {
  it('skips any branch but main, even when the bot changed', () => {
    repo(); change('bot/a.js');
    expect(run('feature')).toBe(0);
  });

  for (const file of ['bot/a.js', 'src/sim/x.js', 'src/ui/tokens.js', 'scripts/discord-notify.js']) {
    it(`builds main when ${file} changed`, () => {
      repo(); change(file);
      expect(run('main')).toBe(1);
    });
  }

  it('skips main when nothing the bot uses changed', () => {
    repo(); change('README.md'); change('src/ui/other.js');
    expect(run('main')).toBe(0);
  });
});
```

Run: `npx vitest run tests/bot/should-build.test.js`
Expected: FAIL. `bot/scripts/should-build.sh` doesn't exist yet: the copy throws ENOENT.

- [ ] **Step 2: Write `bot/scripts/should-build.sh`**

```bash
#!/usr/bin/env bash
# Vercel's "Ignored Build Step" for the /dyno bot: exit 0 skips the deploy, exit 1 builds it.
#
# Only main gets a live bot. Branches and pull requests, forks included, are skipped
# outright, so nobody's unmerged code ever answers in the testers' server.
#
# On main, build only when something the bot runs changed: the bot itself, the sim, the
# colour tokens the chart reads, or the embed builder the reply uses. Anything else (the
# app's UI, docs) would redeploy an identical bot. If the diff can't be computed (no
# parent commit in the clone), git exits non-zero and the deploy goes ahead, the safe way
# to fail.
set -u

if [ "${VERCEL_GIT_COMMIT_REF:-}" != "main" ]; then
  echo "Not main (${VERCEL_GIT_COMMIT_REF:-unset}): skipping. Only main gets a live bot."
  exit 0
fi

if git diff --quiet HEAD^ HEAD -- . ../src/sim ../src/ui/tokens.js ../scripts/discord-notify.js; then
  echo "Nothing the bot uses changed: skipping."
  exit 0
fi

echo "The bot or something it imports changed: building."
exit 1
```

Run: `chmod +x bot/scripts/should-build.sh && npx vitest run tests/bot/should-build.test.js`
Expected: 6 tests pass.

- [ ] **Step 3: Create the bot package and install it**

`bot/package.json`:

```json
{
  "name": "ecu-lab-dyno-bot",
  "private": true,
  "type": "module",
  "description": "The /dyno Discord command: runs ECU Lab's sim from main, on Vercel. See README.md.",
  "engines": {
    "node": "22.x"
  },
  "dependencies": {
    "@resvg/resvg-js": "2.6.2",
    "@vercel/functions": "3.10.1"
  }
}
```

`bot/.gitignore`:

```
node_modules/
.vercel/
```

Run: `cd bot && npm install && cd ..`
Expected: `bot/package-lock.json` is created and `bot/node_modules/@resvg/resvg-js` exists.

In `eslint.config.js`, add `'bot/node_modules/**'` to the `ignores` array after `'node_modules/**'`.

- [ ] **Step 4: Bundle the font**

resvg can't read WOFF or WOFF2. With them it silently draws no text, as tested while planning. The TTF comes from the `@expo-google-fonts/roboto` npm package (OFL-1.1 font licence):

```bash
SCRATCH="$(mktemp -d)"
(cd "$SCRATCH" && npm pack @expo-google-fonts/roboto@0.4.3 >/dev/null && tar -xzf expo-google-fonts-roboto-0.4.3.tgz)
mkdir -p bot/fonts
cp "$SCRATCH/package/400Regular/Roboto_400Regular.ttf" bot/fonts/Roboto-Regular.ttf
cp "$SCRATCH/package/LICENSE_FONT" bot/fonts/LICENSE
head -5 bot/fonts/LICENSE
rm -rf "$SCRATCH"
```

Expected: `head` shows the SIL Open Font License header, and `bot/fonts/Roboto-Regular.ttf` is about 159 KB.

- [ ] **Step 5: Write `bot/render.js`**

```js
/**
 * SVG to PNG for `/dyno`'s chart, with resvg.
 *
 * Discord shows a PNG inline but not an SVG, and a serverless function has no browser to
 * draw with. resvg is a native SVG renderer (what Vercel's own image generation uses) and
 * needs no system libraries.
 *
 * It sees exactly one font, the bundled Roboto TTF, with system fonts off: a serverless
 * box has none worth relying on, and resvg reads neither WOFF nor WOFF2. The chart
 * names Roboto for that reason. `vercel.json` ships `fonts/` with the function explicitly,
 * since a path built at runtime is invisible to Vercel's file tracing.
 */

import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { CHART_WIDTH } from './lib/chart.js';

const FONT_FILE = fileURLToPath(new URL('./fonts/Roboto-Regular.ttf', import.meta.url));

/**
 * @param {string} svg
 * @returns {Uint8Array} PNG bytes
 */
export function svgToPng(svg) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CHART_WIDTH },
    font: { fontFiles: [FONT_FILE], loadSystemFonts: false, defaultFontFamily: 'Roboto' },
  });
  return resvg.render().asPng();
}
```

- [ ] **Step 6: Write `bot/scripts/preview.js` and look at every chart**

```js
/**
 * Renders the chart every preset would get, stock and with all three bolt-ons, to PNG
 * files, so the real resvg output can be looked at before a deploy. The root test suite
 * never loads resvg's native binary; this is the check of bot/render.js.
 *
 *   cd bot && npm ci && node scripts/preview.js <output-dir>
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ENGINE_PRESETS } from '../../src/sim/index.js';
import { dynoChartSvg } from '../lib/chart.js';
import { runDyno } from '../lib/dyno.js';
import { replyTitle } from '../lib/reply.js';
import { svgToPng } from '../render.js';

const dir = resolve(process.argv[2] ?? 'dyno-preview');
mkdirSync(dir, { recursive: true });

for (const preset of ENGINE_PRESETS) {
  for (const [suffix, options] of [['stock', {}], ['bolt-ons', { intake: true, exhaust: true, headers: true }]]) {
    const run = runDyno({ engine: preset.id, ...options });
    const file = join(dir, `${preset.id}-${suffix}.png`);
    writeFileSync(file, svgToPng(dynoChartSvg({ stock: run.stock, modified: run.modified, title: replyTitle(run) })));
    console.log(file);
  }
}
```

Run: `cd bot && node scripts/preview.js "$SCRATCHPAD/dyno-preview" && cd ..`, where `$SCRATCHPAD` is the session's scratchpad directory.
Expected: 14 file paths printed. Open at least `vq35hr-bolt-ons.png`, `b58-m1-stock.png` and `ea888-gti-bolt-ons.png` with the Read tool and check:
- the title and axis numbers are drawn, not blank
- the power line is blue and the torque line cyan
- the dashed stock lines show only on `-bolt-ons` files
- nothing is clipped at the edges
- the legend doesn't overlap

Fix `chart.js` if any of these fails, and rerun Task 4's tests afterwards.

- [ ] **Step 7: Write the Vercel entry and config**

`bot/api/interactions.js`:

```js
/**
 * The URL Discord calls for `/dyno`. All the logic is in lib/handler.js; this file only
 * hands it the runtime: Vercel's `waitUntil`, the resvg renderer, `fetch`, and the two
 * environment variables (DISCORD_PUBLIC_KEY, set in the Vercel project, which is public by
 * design; VERCEL_GIT_COMMIT_SHA, which Vercel sets).
 */

import { waitUntil } from '@vercel/functions';
import { createHandler } from '../lib/handler.js';
import { svgToPng } from '../render.js';

const handle = createHandler({
  publicKey: process.env.DISCORD_PUBLIC_KEY,
  waitUntil,
  render: svgToPng,
  fetch: globalThis.fetch,
  sha: process.env.VERCEL_GIT_COMMIT_SHA,
});

/** @param {Request} request */
export function POST(request) {
  return handle(request);
}
```

`bot/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "ignoreCommand": "bash scripts/should-build.sh",
  "functions": {
    "api/interactions.js": {
      "maxDuration": 15,
      "includeFiles": "fonts/**"
    }
  }
}
```

- [ ] **Step 8: Check what Vercel would bundle**

Vercel works out a function's files by tracing its imports. Run the same tracer locally:

```bash
cd bot && npx --yes @vercel/nft@1.11.0 print api/interactions.js > "$SCRATCHPAD/nft.txt"; cd ..
grep -E "src/sim/index.js|src/sim/rig.js|src/ui/tokens.js|scripts/discord-notify.js|resvg-js|@vercel/functions" "$SCRATCHPAD/nft.txt"
grep -nE "(^|[ /])package\.json$" "$SCRATCHPAD/nft.txt"
```

Expected:
- every listed source file appears
- a root `package.json` (`../package.json`, relative to `bot/`) appears. It tells Node that `src/**/*.js` is ESM.

`fonts/` won't appear, which is why `includeFiles` exists. If `../package.json` is missing, note it in the PR description as a first-deploy risk, with the symptom: "Cannot use import statement outside a module" in the function log.

- [ ] **Step 9: Write `bot/scripts/register.js`**

```js
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
```

In `tsconfig.json`, add `"bot/scripts/register.js"` to `include` after `"bot/lib"`. Leave out `preview.js`, `render.js` and `api/`: they import packages that exist only in `bot/node_modules`, which root CI doesn't install.

Run: `node bot/scripts/register.js; echo "exit $?"` with none of the three variables set.
Expected: `Set DISCORD_APP_ID, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN in this shell first.` and `exit 1`. Nothing is sent.

- [ ] **Step 10: Write `bot/README.md`**

```markdown
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
```

- [ ] **Step 11: Add the agents' line to `CLAUDE.md`**

In `CLAUDE.md`, under `## Repository and releases`, add this bullet after the "**Only GitHub-made Actions can run.**" bullet:

```markdown
- **The `/dyno` Discord bot (`bot/`) deploys from `main`, not from tags.** Vercel's GitHub
  app rebuilds it when `main` changes the bot, `src/sim`, `src/ui/tokens.js` or
  `scripts/discord-notify.js` (`bot/scripts/should-build.sh`). It runs `buildRig` from
  `src/sim/rig.js`, so anything that stops `src/sim` running in plain Node breaks `/dyno`
  too. The Vercel project and the Discord app belong to the owner; agents never handle
  their keys or tokens.
```

- [ ] **Step 12: Run every gate**

```bash
npm test; echo "vitest exit $?"
npm run lint && npm run typecheck && npm run build
git diff --quiet origin/main -- tests/fixtures/fingerprint.sha256 && echo "fingerprint untouched"
```

Expected:
- `vitest exit 0`
- lint, typecheck and build succeed
- `fingerprint untouched`

The `npm run build` crash noted in memory is intermittent: rerun it once before treating a failure as real.

- [ ] **Step 13: Commit**

```bash
git add bot/ tests/bot/should-build.test.js eslint.config.js tsconfig.json CLAUDE.md
git status --short   # bot/node_modules must not appear
git commit -m "Add the /dyno bot's runtime, Vercel config, scripts and setup guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the tasks

1. Push `claude/discord-dyno-bot` and open a **draft** PR against `main` titled "Add a /dyno Discord command for testers". The description covers:
   - the spec link
   - the `buildRig` move, with evidence that the fingerprint is unchanged
   - the preview PNG check
   - the nft trace result
   - the owner's setup steps (bot/README.md)
   - the known limit: `EcuLab.jsx` keeps its own assembly

   End it with the attribution line.
2. Bind the PR with the ccd_pr tools, then read its CI.
3. Danny merges with `--admin`. After the merge, Danny does the setup in bot/README.md, then tries `/dyno engine: Nissan VQ35HR intake: True headers: True` in the testers' channel.
