// @vitest-environment jsdom

/**
 * The table editor's axis breakpoints: a breakpoint the ECU could not search is
 * refused, and the box always shows the breakpoint the table actually has.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CalTable } from '../../src/ui/components/ecu/CalTable.jsx';

afterEach(cleanup);

/** @type {import('../../src/sim/ecu/calibration.js').EcuFieldMeta} */
const META = {
  path: 'test.curve', section: 'test', group: 'Test', label: 'Test curve', kind: 'curve', unit: '%',
  xLabel: 'RPM', min: 0, max: 100, help: 'A curve for the test.',
};

/** A CalTable over its own state, with an external "undo" that puts the first table back. */
function Harness() {
  /** @type {import('../../src/ui/components/ecu/tableOps.js').Table} */
  const first = { x: [1000, 2000, 3000], z: [10, 20, 30] };
  const [table, setTable] = React.useState(first);
  return (
    <>
      <button type="button" onClick={() => setTable(first)}>undo</button>
      <CalTable table={table} meta={META} onChange={setTable} />
    </>
  );
}

const box = (i) => /** @type {HTMLInputElement} */ (screen.getByLabelText(`RPM breakpoint ${i}`));

describe('axis breakpoints', () => {
  it('refuses one out of order, or blank, and shows the breakpoint the table kept', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Axes' }));
    fireEvent.change(box(2), { target: { value: '3500' } });
    fireEvent.blur(box(2));
    expect(box(2).value).toBe('2000');
    fireEvent.change(box(2), { target: { value: '' } });
    fireEvent.blur(box(2));
    expect(box(2).value).toBe('2000');
  });

  it('redraws a moved breakpoint when the table is put back from outside', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Axes' }));
    fireEvent.change(box(2), { target: { value: '2500' } });
    fireEvent.blur(box(2));
    expect(box(2).value).toBe('2500');
    fireEvent.click(screen.getByText('undo'));
    expect(box(2).value).toBe('2000');
  });
});
