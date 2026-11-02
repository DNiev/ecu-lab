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
let baseSha;

function git(...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
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
  git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base');
  baseSha = git('rev-parse', 'HEAD');
}

/** Rewrites each file and commits them together, so one commit touches all of them. */
function changeAll(files) {
  for (const file of files) writeFileSync(join(dir, file), '2\n');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qam', `change ${files.join(', ')}`);
}

function change(file) {
  changeAll([file]);
}

/** Runs the script as Vercel would. `previousSha` is the last successful deployment's commit. */
function run(ref, previousSha) {
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, VERCEL_GIT_COMMIT_REF: ref };
  // A stray value from the developer's shell must not leak into the "no previous SHA" case.
  delete env.VERCEL_GIT_PREVIOUS_SHA;
  if (previousSha) env.VERCEL_GIT_PREVIOUS_SHA = previousSha;
  return spawnSync('bash', ['scripts/should-build.sh'], { cwd: join(dir, 'bot'), encoding: 'utf8', env }).status;
}

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('should-build.sh', () => {
  it('skips any branch but main, even when the bot changed', () => {
    repo(); change('bot/a.js');
    expect(run('feature')).toBe(0);
  });

  for (const file of ['bot/a.js', 'src/sim/x.js', 'src/ui/tokens.js', 'scripts/discord-notify.js']) {
    it(`builds main when ${file} changed since the last deploy`, () => {
      repo(); change(file);
      expect(run('main', baseSha)).toBe(1);
    });
  }

  it('builds main when there is no previous deployment (the first deploy)', () => {
    repo();
    expect(run('main')).toBe(1);
  });

  it('skips main when only files the bot does not use changed', () => {
    repo(); changeAll(['README.md', 'src/ui/other.js']);
    expect(run('main', baseSha)).toBe(0);
  });

  // The case `git diff HEAD^ HEAD` got wrong: the bot's change was not the latest commit,
  // so it would have been skipped, and the bot would never have picked it up.
  it('builds main when a bot change is followed by an unrelated commit', () => {
    repo(); change('bot/a.js'); change('README.md');
    expect(run('main', baseSha)).toBe(1);
  });

  it('builds main when the previous deployment is not in the clone', () => {
    repo(); change('README.md');
    expect(run('main', '0'.repeat(40))).toBe(1);
  });
});
