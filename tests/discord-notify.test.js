/**
 * The Discord webhook payload builder behind scripts/discord-notify.js.
 *
 * Discord rejects a webhook body outright when any text field is over its limit or when
 * a field value is empty, and the notifier deliberately never fails a deploy over a
 * Discord problem — so a payload that breaks a limit means the alert is silently lost.
 * These pin the limits so a long commit message or an empty field can't do that.
 */

import { describe, expect, it, vi } from 'vitest';

import { buildPayload } from '../scripts/discord-notify.js';

const ELLIPSIS = '…';

/** The single embed of a payload built from `input`. */
const embedOf = (input) => buildPayload(input).embeds[0];

describe('buildPayload text limits', () => {
  const cases = [
    { label: 'title', limit: 256, read: (/** @type {string} */ text) => embedOf({ title: text }).title },
    { label: 'description', limit: 4096, read: (/** @type {string} */ text) => embedOf({ title: 't', description: text }).description },
    { label: 'field name', limit: 256, read: (/** @type {string} */ text) => embedOf({ title: 't', fields: [{ name: text, value: 'v' }] }).fields[0].name },
    { label: 'field value', limit: 1024, read: (/** @type {string} */ text) => embedOf({ title: 't', fields: [{ name: 'n', value: text }] }).fields[0].value },
    { label: 'footer', limit: 2048, read: (/** @type {string} */ text) => embedOf({ title: 't', footer: text }).footer.text },
  ];

  for (const { label, limit, read } of cases) {
    it(`truncates an overlong ${label} to exactly ${limit} characters ending in an ellipsis`, () => {
      const out = read('x'.repeat(limit + 500));
      expect(out).toHaveLength(limit);
      expect(out.endsWith(ELLIPSIS)).toBe(true);
      expect(out.slice(0, -1)).toBe('x'.repeat(limit - 1));
    });

    it(`leaves a ${label} at the limit untouched`, () => {
      const text = 'y'.repeat(limit);
      expect(read(text)).toBe(text);
    });

    it(`leaves a short ${label} untouched`, () => {
      expect(read('short')).toBe('short');
    });
  }

  it('keeps only the first 25 fields', () => {
    const fields = Array.from({ length: 40 }, (_, i) => ({ name: `n${i}`, value: `v${i}` }));
    const out = embedOf({ title: 't', fields }).fields;
    expect(out).toHaveLength(25);
    expect(out[0].name).toBe('n0');
    expect(out[24].name).toBe('n24');
  });

  it('counts the 25-field cap after dropping empty fields', () => {
    const fields = [
      { name: 'empty', value: '' },
      ...Array.from({ length: 30 }, (_, i) => ({ name: `n${i}`, value: `v${i}` })),
    ];
    const out = embedOf({ title: 't', fields }).fields;
    expect(out).toHaveLength(25);
    expect(out[0].name).toBe('n0');
  });
});

describe('buildPayload omits empty parts', () => {
  it('wraps a single embed in the webhook body', () => {
    expect(buildPayload({ title: 'Hello' })).toEqual({ embeds: [{ title: 'Hello' }] });
  });

  it('has no url, description, footer, fields or color key when none are given', () => {
    const embed = embedOf({ title: 'Hello' });
    for (const key of ['url', 'description', 'footer', 'fields', 'color']) {
      expect(embed).not.toHaveProperty(key);
    }
  });

  it('treats empty strings, an empty fields array and a bad color the same as absent', () => {
    const embed = embedOf({
      title: 'Hello',
      url: '',
      description: '',
      footer: '',
      fields: [],
      color: '',
    });
    expect(embed).toEqual({ title: 'Hello' });
  });

  it('drops fields with an empty name or an empty value, keeping the rest in order', () => {
    const embed = embedOf({
      title: 'Hello',
      fields: [
        { name: 'a', value: '1' },
        { name: 'b', value: '' },
        { name: '', value: '3' },
        { name: 'd' },
        { value: '5' },
        { name: 'f', value: '6' },
      ],
    });
    expect(embed.fields).toEqual([
      { name: 'a', value: '1' },
      { name: 'f', value: '6' },
    ]);
  });

  it('omits fields entirely when every field is dropped', () => {
    expect(embedOf({ title: 'Hello', fields: [{ name: 'a', value: '' }] })).not.toHaveProperty('fields');
  });

  it('passes url, description, footer and inline through when given', () => {
    const embed = embedOf({
      title: 'Hello',
      url: 'https://example.com/run/1',
      description: 'Body',
      footer: 'ecu-lab',
      fields: [{ name: 'a', value: '1', inline: true }, { name: 'b', value: '2' }],
    });
    expect(embed).toEqual({
      title: 'Hello',
      url: 'https://example.com/run/1',
      description: 'Body',
      footer: { text: 'ecu-lab' },
      fields: [{ name: 'a', value: '1', inline: true }, { name: 'b', value: '2' }],
    });
  });
});

describe('buildPayload color', () => {
  it('passes an integer through', () => {
    expect(embedOf({ title: 't', color: 15158332 }).color).toBe(15158332);
  });

  it('parses a decimal string', () => {
    expect(embedOf({ title: 't', color: '15158332' }).color).toBe(15158332);
  });

  it('parses 0x and # hex strings', () => {
    expect(embedOf({ title: 't', color: '0x2ecc71' }).color).toBe(0x2ecc71);
    expect(embedOf({ title: 't', color: '#2ecc71' }).color).toBe(0x2ecc71);
  });

  it('keeps zero, which is a valid (black) colour', () => {
    expect(embedOf({ title: 't', color: 0 }).color).toBe(0);
    expect(embedOf({ title: 't', color: '0' }).color).toBe(0);
  });

  it('omits an invalid colour rather than sending garbage', () => {
    for (const color of ['not-a-number', '#zzz', NaN, -1, 1.5, null, undefined]) {
      expect(embedOf({ title: 't', color })).not.toHaveProperty('color');
    }
  });
});

describe('importing the module', () => {
  it('has no side effects: it does not run the CLI or call fetch', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    try {
      vi.resetModules();
      const mod = await import('../scripts/discord-notify.js');
      expect(typeof mod.buildPayload).toBe('function');
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
