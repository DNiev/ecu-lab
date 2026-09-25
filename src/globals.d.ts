/**
 * Ambient declarations for host APIs that are not part of the DOM standard.
 */

/**
 * The Claude Artifact sandbox injects a key/value store at `window.storage`. It does
 * not exist in a normal browser, which is exactly why `src/storage.js` feature-detects
 * it rather than assuming it.
 */
interface ArtifactStorage {
  get(key: string): Promise<{ value: string | null } | null>;
  set(key: string, value: string): Promise<void>;
}

interface Window {
  storage?: ArtifactStorage;
  webkitAudioContext?: typeof AudioContext;
}
