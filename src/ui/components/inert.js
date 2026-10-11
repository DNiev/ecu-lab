/**
 * The `inert` half of the hand-rolled disclosures (`BuildSection`, `ExpandableInfo`,
 * issue 81). A shut body stays mounted so it can animate, so it has to be `inert`, or a
 * screen reader reads it and Tab lands on controls nobody can see.
 */

/**
 * Props that make a disclosure body inert while it is shut. Spread onto the body:
 * `<div {...inertWhen(!open)}>`.
 *
 * React 18 drops a boolean `inert`, so it has to be the string ''; @types/react 18 types
 * `inert` only as experimental, hence the plain `object` return. On React 19 this must
 * become `{ inert: shut }` (the hasAttribute check in tests/ui/disclosures.test.jsx
 * would catch it).
 *
 * @param {boolean} shut
 * @returns {object}
 */
export function inertWhen(shut) {
  return shut ? { inert: '' } : {};
}

/**
 * The header of the shut disclosure that hides `el`, or null when `el` is not hidden by
 * one. That header is where focus goes when it cannot stay on `el`. The outermost inert
 * ancestor counts, because a header nested inside another shut body is no more
 * focusable than `el` is.
 *
 * @param {Element|null} el
 * @returns {HTMLElement|null}
 */
export function headerHiding(el) {
  let shut = el?.isConnected ? el.closest('[inert]') : null;
  if (!shut) return null;
  for (let up = shut.parentElement?.closest('[inert]'); up; up = up.parentElement?.closest('[inert]')) shut = up;
  return shut.id ? document.querySelector(`[aria-controls="${shut.id}"]`) : null;
}
