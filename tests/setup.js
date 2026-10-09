/**
 * Global test setup: give every test a clean URL.
 *
 * Navigation moved into `window.location.hash` (see src/ui/useRoute.js), and jsdom
 * gives a whole test FILE one `window`. Without this, the hash a test leaves behind
 * is the hash the next test's `render(<EcuLab />)` boots from — so a test that clicks
 * into BUILD silently deep-links the next one past the start screen it was written to
 * assert on. That is a property of the fixture, not of the app, and it belongs here
 * rather than in each file: `tests/ui/characterisation.test.jsx` is deliberately
 * frozen (issue #83 owns it) and cannot be given a `beforeEach` of its own.
 *
 * This is a `beforeEach` rather than an `afterEach` so it also covers the first test
 * in a file, and so a test that deliberately deep-links can still set the hash in its
 * own body afterwards.
 *
 * Guarded on `window` because most of this suite — the whole `src/sim` side — runs in
 * the default node environment, where there is no `location` to reset. Files opt into
 * jsdom individually with `// @vitest-environment jsdom`.
 */

import { beforeEach } from 'vitest';

beforeEach(() => {
  if (typeof window === 'undefined') return;
  // Assigning the empty string removes the fragment entirely (per the HTML spec's
  // Location#hash setter), which is what `parseRoute` reads as the start screen.
  window.location.hash = '';
});

/**
 * jsdom 25 has `HTMLDialogElement` but not `showModal`/`close`. These do the part a
 * test can observe — the `open` flag and the `close` event — and none of the modal
 * behaviour (top layer, inert page, focus return), which is checked in a browser.
 */
if (typeof window !== 'undefined' && window.HTMLDialogElement && !window.HTMLDialogElement.prototype.showModal) {
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function close() {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
}
