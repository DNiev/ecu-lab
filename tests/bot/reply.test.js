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

describe('replyTitle for a preset whose own fuel is not a pump fuel', () => {
  it('does not throw for a preset shipping on Flex, and says stock', () => {
    const base = S.presetById('vq35hr');
    const preset = { ...base, parts: { ...base.parts, octaneIdx: 4 } };
    const title = () => replyTitle({ preset, mods: base.mods, fuel: S.FUEL_CHOICES[4] });
    expect(title).not.toThrow();
    expect(title()).toContain('stock');
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
