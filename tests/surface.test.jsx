// @vitest-environment jsdom
/**
 * The 3-D table view: a point lands where the ECU reads it, the surface reads what the
 * simulator's own interpolation reads, and the view renders (and says when a pull has no
 * path across a table) without a canvas.
 */

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { LOAD, RPM, interp2 } from '../src/sim/index.js';
import { fracIndex, readSurface } from '../src/ui/components/surface/Surface3D.jsx';
import { PullTraceContext, TableSurface } from '../src/ui/components/surface/TableSurface.jsx';

describe('placing a point on the table', () => {
  it('finds the fractional breakpoint index, clamped at the ends', () => {
    const axis = [800, 1500, 2500, 3500];
    expect(fracIndex(axis, 800)).toBe(0);
    expect(fracIndex(axis, 2000)).toBeCloseTo(1.5, 12);
    expect(fracIndex(axis, 3500)).toBe(3);
    expect(fracIndex(axis, 100)).toBe(0);
    expect(fracIndex(axis, 9000)).toBe(3);
  });
  it('reads exactly what the simulator reads from the same RPM × MAP grid', () => {
    // A grid stored the simulator's way (highest load first), turned over for the surface.
    const grid = LOAD.map((l, r) => RPM.map((rpm, c) => 10 + r * 3 + c * 1.7 + (rpm * l) / 1e5));
    const z = [...grid].reverse();
    const yUp = [...LOAD].reverse();
    for (const [rpm, kpa] of [[800, 20], [3000, 85], [4500, 100], [6100, 137], [7500, 200], [2200, 55]]) {
      expect(readSurface(RPM, yUp, z, rpm, kpa)).toBeCloseTo(interp2(grid, rpm, kpa), 9);
    }
  });
});

describe('the 3-D view', () => {
  // jsdom has no 2-D canvas; the view draws nothing without one, and is tested on what it says.
  beforeAll(() => { window.HTMLCanvasElement.prototype.getContext = () => null; });
  afterEach(cleanup);
  const x = [1000, 4000, 7000];
  const y = [30, 100];
  const z = [[10, 20, 30], [15, 25, 35]];
  const pull = [1500, 3000, 4500, 6000].map((rpm) => ({ rpm, map: 98, sensedMap: 99, commandedTiming: 20 }));
  it('offers a pull when both axes are ones a pull moves', () => {
    render(
      <PullTraceContext.Provider value={pull}>
        <TableSurface x={x} y={y} z={z} lo={0} hi={40} xLabel="RPM" yLabel="MAP kPa" title="Spark" xVar="rpm" yVar="map" />
      </PullTraceContext.Provider>,
    );
    expect(screen.getByRole('img', { name: /3-D view of Spark/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Simulate a pull' })).toBeTruthy();
  });
  it('says so when a pull holds an axis steady', () => {
    render(
      <PullTraceContext.Provider value={pull}>
        <TableSurface x={x} y={y} z={z} lo={0} hi={40} xLabel="RPM" yLabel="Throttle %" title="Torque" xVar="rpm" yVar="tps" />
      </PullTraceContext.Provider>,
    );
    expect(screen.queryByRole('button', { name: 'Simulate a pull' })).toBeNull();
    expect(screen.getByText(/holds Throttle % steady/)).toBeTruthy();
  });
});
