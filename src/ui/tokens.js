/**
 * The palette, type scale, radius scale and spacing scale — the single place
 * each is defined.
 *
 * `tokens.css` mirrors this file as CSS custom properties for stylesheets, and
 * `tests/tokens.test.js` proves the two never drift. Add a token here first.
 *
 * The organising rule for colour: THE ACCENT IS NEVER A STATUS, AND A STATUS IS
 * NEVER DECORATION. `acc` means "this is the action" or "this is the live value".
 * `ok`/`warn`/`danger` mean engine state and nothing else. The previous palette
 * spent its alarm colour on chrome — 84 uses of the same hot orange on the
 * wordmark, the nav, the focus ring and genuine warnings alike — which left a real
 * warning nothing to escalate to.
 *
 * The organising rule for the font-size/radius/spacing scales below: they were
 * added after nine primitives and two screens had already accumulated 15 raw
 * font-sizes, 8 raw radii and 17 raw padding declarations between them — each
 * file looked reasonable alone, but a fourteen-screen build is about to land on
 * top of this layer, and that is a lot cheaper to systematise now than to
 * retrofit later. Not every raw value in the stylesheets maps onto a step here:
 * a handful are one-off screen headlines or values pinned to another number
 * by layout geometry, and those stay raw with a comment explaining why, rather
 * than being forced onto the ramp.
 */

/** @param {string} s camelCase token name @returns {string} its kebab-case CSS name */
export const camelToKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** @type {Readonly<Record<string,string>>} */
export const tokens = Object.freeze({
  // Surfaces, darkest to lightest. The base is blue-black rather than neutral grey
  // because red reads harder against blue than against grey.
  bg: '#0a0d14',
  panel: '#131824',
  panel2: '#1a2130',
  panel3: '#212a3c',

  // Borders.
  line: '#262f42',
  lineHi: '#33405a',

  // Text, four steps from primary to faintest.
  ink: '#e9eef8',
  inkSoft: '#c8d2e2',
  ink2: '#8792a8',
  ink3: '#5c6880',

  // Accent. `accOn` is text placed ON an accent fill — it must never be a grey.
  acc: '#4c9eff',
  accInk: '#8fc2ff',
  accBg: '#0f2033',
  accOn: '#04162e',

  // Status. Reserved for engine state. Never used as decoration.
  ok: '#35e08a',
  okInk: '#7fe8b4',
  okBg: '#0d2419',
  warn: '#ffb020',
  warnInk: '#ffd07a',
  warnBg: '#2a2110',
  danger: '#ff4d4d',
  dangerInk: '#ff9d9d',
  dangerBg: '#2a1414',

  // Status borders. One step brighter than the matching *Bg so a status box reads as
  // a bounded object rather than a wash — without reaching the full status hue, which
  // belongs to text and indicators. These are for a status BOX's border — something
  // that reports state, like Note or an inline banner. A destructive CONTROL (e.g.
  // Button's danger variant) deliberately uses the saturated hue instead, because it
  // needs to read louder than something that merely reports; that is not an
  // inconsistency to "fix" by pointing it at these tokens too.
  okLine: '#1e5238',
  warnLine: '#5c4415',
  dangerLine: '#5c2626',
  violetLine: '#3b3363',

  // Secondary data hue, for charts that must plot two series at once (power vs
  // torque). Distinct from `acc` on purpose so a chart never looks like a control.
  cyan: '#38d9f0',
  cyanBg: '#0b2630',
  violet: '#a78bfa',
  violetBg: '#1d1a33',

  // Type.
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",

  // Bare RGB triplets, so translucent washes can be built from the same colours
  // rather than re-typing them at a new alpha. See accAlpha/shadowAlpha below.
  accRgb: '76, 158, 255',
  shadowRgb: '0, 0, 0',

  // Font-size scale, small to large. Named by role/size rather than kept as the
  // 15 raw values they replace, because a scale is a small set of deliberate
  // steps, not every number a designer happened to type. `fsMicro` and `fsXs`
  // carry the small uppercase UI chrome (eyebrows, badges, segmented-control
  // labels); `fsSm`/`fsBase` carry compact and standard body/control text;
  // `fsMd` is screen-body copy; `fsLg` is the large mono figure in a stat tile.
  // One-off screen headlines (21/25/27/34px) are not part of this ramp — see
  // the comments at their declarations for why.
  fsMicro: '9px',
  fsXs: '10.5px',
  fsSm: '12px',
  fsBase: '13.5px',
  fsMd: '14.5px',
  fsLg: '18px',

  // Border-radius scale, small to large. Covers the eight raw radii the
  // stylesheets had accumulated; `50%` circles and one pill radius pinned to
  // half of its own element's height are deliberately left out — see the
  // comment at that declaration.
  rXs: '3px',
  rSm: '6px',
  rMd: '9px',
  rLg: '12px',

  // Spacing scale, for padding. Covers the seventeen raw padding declarations
  // the stylesheets had accumulated. A few values stay raw with a comment
  // because they are pinned to something other than rhythm: a chevron's
  // clearance, a knob's fit inside its track.
  spXs: '3px',
  spSm: '7px',
  spMd: '10px',
  spLg: '13px',
  spXl: '16px',
  spXxl: '24px',
});

/**
 * A translucent accent wash — glows, focus halos, the shadow under a primary button.
 *
 * Lives here rather than in a screen because an `rgba()` literal in a component is
 * precisely what this system exists to prevent, and `tests/no-hardcoded-colours.test.js`
 * rejects one.
 *
 * @param {number} alpha 0-1
 * @returns {string} an rgba() colour
 */
export const accAlpha = (alpha) => `rgba(${tokens.accRgb}, ${alpha})`;

/**
 * A plain black scrim, for drop shadows and cell borders that must darken whatever
 * is underneath rather than tint it.
 *
 * @param {number} alpha 0-1
 * @returns {string} an rgba() colour
 */
export const shadowAlpha = (alpha) => `rgba(${tokens.shadowRgb}, ${alpha})`;

/**
 * The drag strip's ART PALETTE — the illustrated scene, not the interface.
 *
 * SEPARATE FROM `tokens` ON PURPOSE, and worth explaining because the split is the
 * whole point. The palette above is a semantic UI system: `acc` means "this is the
 * action", `ok`/`warn`/`danger` mean engine state. A car, a road surface and a
 * christmas tree have none of those meanings — a yellow car is not a warning — so
 * routing them through the status ramp would make the system say something it does not
 * mean, and would repaint the scene the next time anyone tunes the interface.
 *
 * It lives in THIS file regardless, because the rule `no-hardcoded-colours.test.js`
 * enforces is that a colour must never be invisible to the token layer. Here it is
 * visible: a palette change lands in one file and finds every colour in the app,
 * scenery included.
 *
 * Not mirrored into `tokens.css`, unlike the palette above, because nothing styles the
 * strip from a stylesheet — the scene is inline SVG and inline styles, so a CSS custom
 * property would be an unused declaration and `tokens.test.js` checks that CSS declares
 * nothing JS does not use.
 */
export const strip = Object.freeze({
  // Bodywork: a four-stop gradient down the flank, plus its highlight edge.
  paintHi: '#ffdf6b',
  paint: '#f7c02a',
  paintMid: '#d99a10',
  paintLow: '#9c6c05',
  paintEdge: '#ffe89a',
  // Panel lines and the rocker, a darker shade of the same paint.
  paintLine: '#8f6206',
  paintShadow: '#7c5405',
  // Glass, lit at the top and dark at the base.
  glassHi: '#54677a',
  glassLow: '#131b23',
  // Lamps.
  headlight: '#f2f7fa',
  taillight: '#cf3535',
  // Tyre, rim and spokes.
  tyre: '#0c1015',
  tyreWall: '#333c46',
  rim: '#242c35',
  rimEdge: '#414b57',
  spoke: '#525d69',

  // The scene behind it: night sky down to the track surface.
  sky: '#070a0e',
  skyLow: '#0d141c',
  horizon: '#1b232c',
  ground: '#232c36',
  groundLow: '#1a2029',
  wall: '#2c343d',
  wallTop: '#3a444f',
  wallPost: '#1b222a',
  surface: '#12171d',
  groove: '#1e262f',
  texture: '#232b34',
  // The finish stripe, alternating light and dark.
  stripeLight: '#eef2f6',
  stripeDark: '#0f141a',

  // Christmas tree: an unlit bulb and its rim, and the white stage lamps.
  bulbOff: '#1a1f26',
  bulbRim: '#232a33',
  stage: '#e8eef4',
});

/** Tyre smoke at a given opacity — it fades as it drifts, so alpha is a parameter. */
export const smokeAlpha = (alpha) => `rgba(214, 222, 230, ${alpha})`;

/** The low sun behind the treeline, at a given opacity. */
export const horizonGlowAlpha = (alpha) => `rgba(255, 150, 60, ${alpha})`;
