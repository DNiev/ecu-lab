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
  and every recharts `<XAxis>`/`<YAxis>` `stroke={T.ink3}` (recharts colours tick labels
  with the axis stroke) becomes `--ink2` / `T.ink2`.
- Chevron and other state-carrying icons coloured through `color` follow the same rule:
  they become `--ink2` too, so no judgement call is needed for them.
- `--ink3` stays legitimate for non-text graphics drawn with `stroke`/`fill` (dial ticks,
  `CalTable`'s outline, the dashed `afrCommanded` series) and for borders. Those are not
  matched by the guard and are not changed.
- A `color` use that really is text-free decoration (an element that holds nothing but
  a graphic) may keep `--ink3` if the declaration's own line, or the line above it,
  contains the word `decorative` in a comment saying why.

## Guard

`tests/no-ink3-text.test.js`, modelled on `tests/no-hardcoded-colours.test.js`: one test
per `.js`/`.jsx`/`.css` file under `src/ui` (except `tokens.js`, `tokens.css`, `theme.js`),
failing on any line matching one of:

- CSS `color` (not `border-color` etc.) set to `var(--ink3)`;
- a JSX `color:` whose expression up to the next `,` or `}` names `T.ink3`;
- `<XAxis` / `<YAxis` with `stroke={T.ink3}`;

unless that line or the one above contains `decorative`. A second test pins the premise:
`ink2` measures at least 4.5:1 against `bg`, `panel`, `panel2` and `panel3`, read from
`src/ui/tokens.js`, so a palette change that breaks it fails loudly instead of silently
reintroducing the problem with the guard still green.

## Testing

The guard and premise tests above. Existing assertions that read a colour off a rendered
element (`tests/ui/readouts.test.jsx`, `dyno-screens`, etc.) are updated where they named
`ink3` for text. A browser pass at desktop and 375px confirms the hierarchy still reads.

## Conflicts

`claude/tutorial-learn` edits several of the same files. Each change here is a one-word
colour swap, so conflicts are trivial; if that branch adds new `--ink3` text, the guard
names the line.
