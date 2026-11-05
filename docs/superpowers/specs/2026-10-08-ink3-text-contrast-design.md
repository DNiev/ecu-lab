# `--ink3` text contrast (#79)

Part of the UI overhaul (#6). `--ink3` (`#5c6880`) measures 2.56–3.47:1 against the four
surfaces (`--bg`, `--panel`, `--panel2`, `--panel3`), below WCAG AA's 4.5:1 for small
text everywhere. `--ink2` (`#8792a8`) measures 4.59–6.21:1 on the same four, so it passes
everywhere. Brightening `--ink3` until it passes would make it `--ink2`, so the fix is per
site, not in the token.

## The rule

Text is never coloured `--ink3`. Hierarchy below `--ink2` comes from size, weight and
letter-spacing, not from a dimmer grey.

- Every `color: var(--ink3)` in a CSS module, every inline `color: … T.ink3 …` in JSX,
  every recharts `<XAxis>`/`<YAxis>` `stroke={T.ink3}` (recharts colours tick labels
  with the axis stroke), and every recharts series coloured `T.ink3` in the prop its
  legend label and tooltip row take (`stroke` for `<Line>`, `fill` for `<Bar>`, so a
  series is text too) becomes `--ink2` / `T.ink2`.
- Chevron and other state-carrying icons coloured through `color` follow the same rule:
  they become `--ink2` too, so no judgement call is needed for them.
- `--ink3` stays legitimate for non-text graphics drawn with `stroke`/`fill` (dial ticks,
  `CalTable`'s outline) and for borders. Those are not matched
  by the guard and are not changed.
- A `color` use that really is text-free decoration (an element that holds nothing but
  a graphic) may keep `--ink3` if the declaration's own line, or the line above it,
  contains the word `decorative` in a comment saying why.

## Guard

`tests/no-ink3-text.test.js`, modelled on `tests/no-hardcoded-colours.test.js`: one test
per `.js`/`.jsx`/`.css` file under `src/ui` (except `tokens.js`, `tokens.css`, `theme.js`
at the `src/ui` root, matched by path so a nested file of the same name is still read).

It reads whole CSS declarations and whole JSX tags rather than lines, with comments
blanked first, so wrapped props, arrow functions inside a tag, and prose that mentions
`T.ink3` are all handled. A reference is `T.ink3`, `tokens.ink3` or `var(--ink3)`, quoted
or not. It fails on:

- a CSS `color` or `-webkit-text-fill-color` (not `border-color` etc.) naming `--ink3`;
- a CSS `fill` naming `--ink3` in a rule whose selector targets SVG `text`/`tspan`;
- a CSS custom property aliasing `--ink3`, which would hide its uses from the guard;
- a JS `color:` key whose whole value (balanced, so `pick(a, T.ink3)` counts) names it;
- a JSX `color`, `tick` or `label` prop naming it, on any tag;
- an axis (`<XAxis>`, `<YAxis>`, …) `stroke`, since recharts colours tick labels with it;
- a series prop that recharts uses for its legend and tooltip text: `stroke` on `<Line>`,
  `stroke`/`fill` on `<Area>` and `<Radar>`, `fill` on `<Bar>`, `<Scatter>`, `<Pie>` and the
  rest (recharts' `getMainColorOfGraphicItem`);
- `fill`/`stroke` on SVG `<text>`/`<tspan>` and recharts `<Text>`, `<Label>`, `<LabelList>`;

unless a comment on that line or the one above contains `decorative`. The word only
counts inside a comment. The guard's own matcher has tests for each case above, both
flagged and passing. A second test pins the premise: `ink2` measures at least 4.5:1
against `bg`, `panel`, `panel2`, `panel3` and every `*Bg` accent and status fill, read
from `src/ui/tokens.js`, so a palette change that breaks it fails loudly instead of
silently reintroducing the problem with the guard still green.

## Testing

The guard and premise tests above. Existing assertions that read a colour off a rendered
element (`tests/ui/readouts.test.jsx`, `dyno-screens`, etc.) are updated where they named
`ink3` for text. A browser pass at desktop and 375px confirms the hierarchy still reads.

## Conflicts

`claude/tutorial-learn` edits several of the same files. Each change here is a one-word
colour swap, so conflicts are trivial; if that branch adds new `--ink3` text, the guard
names the line.
