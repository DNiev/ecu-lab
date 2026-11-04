import { describe, expect, it } from 'vitest';

import * as S from '../../src/sim/index.js';
import { dynoCommand } from '../../bot/lib/command.js';
import { runDyno } from '../../bot/lib/dyno.js';

const STRING = 3;
const BOOLEAN = 5;
const cmd = dynoCommand();
const option = (name) => cmd.options.find((o) => o.name === name);

describe('dynoCommand', () => {
  it('is a slash command named dyno', () => {
    expect(cmd).toMatchObject({ name: 'dyno', type: 1 });
    expect(cmd.description.length).toBeGreaterThan(0);
    expect(cmd.description.length).toBeLessThanOrEqual(100);
  });

  it('requires an engine, chosen from every preset', () => {
    const engine = option('engine');
    expect(engine).toMatchObject({ type: STRING, required: true });
    expect(engine.choices).toEqual(S.ENGINE_PRESETS.map((p) => ({ name: p.name, value: p.id })));
    expect(cmd.options[0]).toBe(engine); // Discord requires required options first
  });

  it('offers the three bolt-ons as optional booleans', () => {
    for (const name of ['intake', 'exhaust', 'headers']) {
      expect(option(name)).toMatchObject({ type: BOOLEAN });
      expect(option(name).required).toBeFalsy();
    }
  });

  it('offers every pump fuel by label', () => {
    expect(option('fuel').type).toBe(STRING);
    expect(option('fuel').choices).toEqual(S.OCTANE_OPTS.map((o) => ({ name: o.label, value: o.label })));
  });

  it('stays inside Discord limits', () => {
    expect(cmd.options.length).toBeLessThanOrEqual(25);
    for (const o of cmd.options) {
      expect(o.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(o.description.length).toBeGreaterThan(0);
      expect(o.description.length).toBeLessThanOrEqual(100);
      for (const c of o.choices ?? []) {
        expect(o.choices.length).toBeLessThanOrEqual(25);
        expect(c.name.length).toBeLessThanOrEqual(100);
        expect(String(c.value).length).toBeLessThanOrEqual(100);
      }
    }
  });

  it('only offers choices that runDyno accepts', () => {
    for (const c of option('engine').choices) expect(() => runDyno({ engine: c.value })).not.toThrow();
    for (const c of option('fuel').choices) expect(() => runDyno({ engine: 'vq35hr', fuel: c.value })).not.toThrow();
  });
});
