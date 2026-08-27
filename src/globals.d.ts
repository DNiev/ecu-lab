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

/**
 * Vite's `?raw` suffix, which inlines a file's text at build time.
 *
 * Used for the exhaust AudioWorklet: a worklet module has to be fetched from a URL, and
 * this app also ships as a single inlined HTML file where there is no second file to
 * fetch, so its source travels as a string and is handed to the browser as a Blob.
 */
declare module '*?raw' {
  const content: string;
  export default content;
}

/**
 * AudioWorklet globals.
 *
 * `AudioWorkletProcessor`, `registerProcessor` and `sampleRate` exist only inside an
 * AudioWorkletGlobalScope, which TypeScript's DOM library does not describe. Declared
 * here so `src/ui/audio/exhaustProcessor.js` type-checks as the ordinary module it is —
 * which matters, because it is also run directly in Node by its tests.
 */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  process(
    inputs: Float32Array[][], outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(name: string, ctor: unknown): void;
declare const sampleRate: number;
