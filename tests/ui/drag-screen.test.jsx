// @vitest-environment jsdom

/**
 * DRAG, mounted on its own.
 *
 * Same purpose as `dash-screens.test.jsx`: a screen that quietly needed the shell to
 * render would look fine from a whole-app test and fail only here. What these add on
 * top is the two rules DRAG exists to hold —
 *
 *   1. NOTHING IS SIMULATED UNTIL IT HAS BEEN MEASURED. Without a dyno pull there is
 *      no torque curve, and the screen says so instead of inventing one.
 *   2. A TIME SLIP DESCRIBES THE CAR THAT RAN IT. Change the car underneath a finished
 *      run and the numbers must be labelled as belonging to the old one, not silently
 *      re-presented as current — the same defect the pull scores had in issue #29.
 *
 * `dragSignature` is unit-tested directly as well, because it is the whole of rule 2
 * and every field it forgets is a change the slip would fail to notice.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CAR, setCal } from '../../src/sim/index.js';
import { DragScreen, dragSignature } from '../../src/ui/screens/drag/DragScreen.jsx';
import { makeInitialState } from '../../src/ui/state/initialState.js';
import { ACTIONS } from '../../src/ui/state/reducer.js';
import { StoreProvider, useSession } from '../../src/ui/state/StoreProvider.jsx';

afterEach(cleanup);

const noop = () => {};
const DERIVED = { redline: 7200 };

/** A dyno result with just the fields DRAG reads off it. */
const RESULT = { points: [], events: [], peakHp: 320, peakTq: 300 };

/** The calibration a fresh store starts with, which the mounted screen reads. */
const ECU = makeInitialState().tune.ecu;

/**
 * Mounts DRAG with a real store, handing the test the store's dispatch so a finished
 * run (or a changed car) can be seeded directly. Same probe-then-rerender shape as
 * `mountWithResult` in dash-screens.test.jsx.
 *
 * @param {object} [props] props to override on the screen
 * @returns {{utils: ReturnType<typeof render>, seed: (field: string, value: *) => void}}
 */
function mountDrag(props = {}) {
  /** @type {Function} */
  let dispatch;
  const Capture = () => {
    const [, d] = useSession();
    dispatch = d;
    return null;
  };
  const node = (
    <DragScreen
      section={null} onToggle={noop} result={RESULT}
      engineDerived={DERIVED} onRun={noop} {...props}
    />
  );
  const utils = render(<StoreProvider><Capture />{node}</StoreProvider>);
  const seed = (field, value) => act(() => dispatch({
    type: ACTIONS.SET_SESSION_FIELD, field, value,
  }));
  return { utils, seed };
}

/** A finished quarter mile, shaped like `simulateDragRun`'s return. */
const FINISHED_RUN = {
  et: 11.82, trapMph: 121.4, sixtyFootT: 1.71, zeroToSixty: 4.32,
  eighthET: 7.6, eighthMph: 98.2, topGearUsed: 4, wheelspun: false, finished: true,
  peakHp: 320,
  trace: [{ t: 0, x: 0, v: 0, rpm: 3200, gear: 1, a: 0, spinning: false, limiter: false, throttle: 1 }],
};

describe('the dyno-pull prerequisite', () => {
  it('refuses to race an engine nobody has measured, and offers no run button', () => {
    render(
      <StoreProvider>
        <DragScreen section={null} onToggle={noop} result={null} engineDerived={DERIVED} onRun={noop} />
      </StoreProvider>,
    );
    expect(screen.getByText(/Run a dyno pull first/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /RUN THE QUARTER MILE/i })).toBeNull();
  });

  it('offers the run once there is a torque curve behind it', () => {
    mountDrag();
    expect(screen.getByRole('button', { name: /RUN THE QUARTER MILE/i })).toBeTruthy();
    expect(screen.queryByText(/Run a dyno pull first/i)).toBeNull();
  });

  it('hands the run back to the shell rather than simulating anything itself', () => {
    const onRun = vi.fn();
    mountDrag({ onRun });
    fireEvent.click(screen.getByRole('button', { name: /RUN THE QUARTER MILE/i }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('disables the button while a run is playing back, so a second run cannot race it', () => {
    const { seed } = mountDrag();
    seed('dragRunning', true);
    expect(/** @type {HTMLButtonElement} */ (screen.getByRole('button', { name: /RUNNING/i })).disabled).toBe(true);
  });
});

describe('the time slip', () => {
  it('reports the run the car actually made', () => {
    const { seed } = mountDrag();
    seed('dragResult', FINISHED_RUN);
    seed('dragSetup', dragSignature(DEFAULT_CAR, RESULT, ECU));
    expect(screen.getByText('11.82')).toBeTruthy();
    expect(screen.getByText('121.4')).toBeTruthy();
    expect(screen.getByText('1.71')).toBeTruthy();
    expect(screen.queryByText(/before your latest change/i)).toBeNull();
  });

  it('says so when the car has changed since the run — it does not silently re-present it', () => {
    // The whole of rule 2. Without the label, swapping slicks for street tyres leaves
    // a 60-foot time on screen that this car cannot run, presented as if it could.
    const { seed } = mountDrag();
    seed('dragResult', FINISHED_RUN);
    seed('dragSetup', dragSignature(DEFAULT_CAR, RESULT, ECU));
    seed('car', { ...DEFAULT_CAR, gripIdx: 3 });
    expect(screen.getByText(/before your latest change/i)).toBeTruthy();
    // And the numbers stay: labelled evidence, not deleted evidence.
    expect(screen.getByText('11.82')).toBeTruthy();
  });

  it('explains a car that never reached the stripe instead of printing a timeout as an ET', () => {
    const { seed } = mountDrag();
    seed('dragResult', { ...FINISHED_RUN, finished: false, et: 40 });
    expect(screen.getByText(/never reached the stripe/i)).toBeTruthy();
    expect(screen.queryByText('40.00')).toBeNull();
  });

  it('calls out wheelspin, because it is the one thing on the slip the player can act on', () => {
    const { seed } = mountDrag();
    seed('dragResult', { ...FINISHED_RUN, wheelspun: true });
    expect(screen.getByText(/Wheelspin off the line/i)).toBeTruthy();
  });

  it('stays hidden while the run is still playing', () => {
    const { seed } = mountDrag();
    seed('dragResult', FINISHED_RUN);
    seed('dragRunning', true);
    expect(screen.queryByText('TIME SLIP')).toBeNull();
  });
});

describe('the car', () => {
  it('writes body changes to the store as a whole car, hardware figures included', () => {
    const { seed } = mountDrag({ section: 'body' });
    seed('car', { ...DEFAULT_CAR });
    fireEvent.click(screen.getByRole('button', { name: 'Truck' }));
    // A truck is heavier and boxier than the coupe the session starts on. Reading it
    // back off the rendered readouts proves the spread landed, not just the index.
    expect(screen.getByText('2350')).toBeTruthy();
    expect(screen.getByText('0.42')).toBeTruthy();
  });

  it('never offers more gears than the ratio table actually holds', () => {
    // `gears[gearCount - 1]` is read straight out for the top-gear readout, so a max
    // past the table's length would render `undefined×` and crash on `.toFixed`.
    const { seed } = mountDrag({ section: 'gearing' });
    seed('car', { ...DEFAULT_CAR });
    const gearCount = /** @type {HTMLInputElement} */ (screen.getByLabelText('Number of gears'));
    expect(Number(gearCount.max)).toBe(DEFAULT_CAR.gears.length);
  });
});

describe('dragSignature', () => {
  it('changes for every input that changes the time', () => {
    const base = dragSignature(DEFAULT_CAR, RESULT);
    const moves = {
      bodyIdx: 3, gripIdx: 2, driveIdx: 1, boxIdx: 1,
      gearCount: 4, finalDrive: 4.1, tireDiameterIn: 30,
    };
    for (const [field, value] of Object.entries(moves)) {
      expect(dragSignature({ ...DEFAULT_CAR, [field]: value }, RESULT), field).not.toBe(base);
    }
    expect(dragSignature({ ...DEFAULT_CAR, gears: [4.2, ...DEFAULT_CAR.gears.slice(1)] }, RESULT)).not.toBe(base);
    // A new pull is the only thing that changes the torque curve the run was driven
    // with, so the engine side of the signature is the pull's own output.
    expect(dragSignature(DEFAULT_CAR, { ...RESULT, peakHp: 400 })).not.toBe(base);
  });

  it('changes with the launch strategy the calibration gives the strip', () => {
    const base = dragSignature(DEFAULT_CAR, RESULT, ECU);
    /** @type {[string, boolean|number][]} */
    const moves = [
      ['arc.launchEnabled', true], ['arc.ffsEnabled', true], ['torque.tcEnabled', true],
      ['limiter.speedLimitKph', 180],
    ];
    for (const [path, value] of moves) {
      expect(dragSignature(DEFAULT_CAR, RESULT, setCal(ECU, path, value)), path).not.toBe(base);
    }
    // A calibration setting the strip never reads leaves the run current.
    expect(dragSignature(DEFAULT_CAR, RESULT, setCal(ECU, 'idle.gainUp', 0.05))).toBe(base);
  });

  it('is stable when nothing that matters has moved', () => {
    expect(dragSignature({ ...DEFAULT_CAR }, RESULT)).toBe(dragSignature(DEFAULT_CAR, RESULT));
  });
});
