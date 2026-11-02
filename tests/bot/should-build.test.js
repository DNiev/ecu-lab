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
  git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base');
}

/** Rewrites each file and commits them together, so one commit touches all of them. */
function changeAll(files) {
  for (const file of files) writeFileSync(join(dir, file), '2\n');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qam', `change ${files.join(', ')}`);
}

function change(file) {
  changeAll([file]);
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
    repo(); changeAll(['README.md', 'src/ui/other.js']);
    expect(run('main')).toBe(0);
  });

  it('builds when there is no parent commit to diff against', () => {
    repo();
    expect(run('main')).toBe(1);
  });
});
