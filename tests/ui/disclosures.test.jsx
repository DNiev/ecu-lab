// @vitest-environment jsdom

/**
 * The two expand/collapse components every screen uses. Both keep a collapsed body
 * mounted so it can animate, which is exactly why each has to say it is shut: an
 * open/closed chevron is nothing to a screen reader, and a mounted body is reachable
 * by Tab unless it is inert.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Wrench } from 'lucide-react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { BuildSection } from '../../src/ui/components/BuildSection.jsx';
import { ExpandableInfo } from '../../src/ui/components/ExpandableInfo.jsx';

afterEach(cleanup);

/** @param {HTMLElement} header @returns {HTMLElement} */
const bodyOf = (header) => /** @type {HTMLElement} */ (document.getElementById(header.getAttribute('aria-controls')));

/** @param {HTMLElement} header @param {boolean} open */
function expectState(header, open) {
  expect(header.getAttribute('aria-expanded')).toBe(String(open));
  const body = bodyOf(header);
  expect(body).toBeTruthy();
  expect(body.hasAttribute('inert')).toBe(!open);
}

function Section() {
  const [open, setOpen] = useState(false);
  return (
    <BuildSection active={open} onClick={() => setOpen(!open)} icon={Wrench} label="Engine">
      <button type="button">inside</button>
    </BuildSection>
  );
}

describe('BuildSection', () => {
  it('announces open and shut, and names its body', () => {
    render(<Section />);
    const header = screen.getByRole('button', { name: /Engine/ });
    expectState(header, false);
    fireEvent.click(header);
    expectState(header, true);
    expect(bodyOf(header).contains(screen.getByText('inside'))).toBe(true);
  });

  it('hands focus to its header when it shuts with focus inside', () => {
    const view = (active) => (
      <BuildSection active={active} onClick={() => {}} icon={Wrench} label="Engine">
        <button type="button">inside</button>
      </BuildSection>
    );
    const { rerender } = render(view(true));
    screen.getByText('inside').focus();
    rerender(view(false));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Engine/ }));
  });

  it('leaves focus alone when it shuts with focus elsewhere', () => {
    const view = (active) => (
      <>
        <button type="button">outside</button>
        <BuildSection active={active} onClick={() => {}} icon={Wrench} label="Engine">
          <button type="button">inside</button>
        </BuildSection>
      </>
    );
    const { rerender } = render(view(true));
    screen.getByText('outside').focus();
    rerender(view(false));
    expect(document.activeElement).toBe(screen.getByText('outside'));
  });

  it('keeps the body as the header button\'s next sibling', () => {
    render(<Section />);
    const header = screen.getByRole('button', { name: /Engine/ });
    expect(header.nextElementSibling).toBe(bodyOf(header));
  });
});

describe('ExpandableInfo', () => {
  it('announces open and shut, and names its body', () => {
    render(<ExpandableInfo title="Why">Because.</ExpandableInfo>);
    const header = screen.getByRole('button', { name: /Why/ });
    expectState(header, false);
    fireEvent.click(header);
    expectState(header, true);
    expect(bodyOf(header).textContent).toContain('Because.');
  });
});
