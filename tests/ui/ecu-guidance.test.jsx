// @vitest-environment jsdom

/**
 * The guidance layer over the engine management pages: each page says what it is for
 * and whether anything on it has changed, and a sensor setting that disagrees with the
 * part on BUILD is shown — with a fix — where the player will see it.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import * as S from '../../src/sim/index.js';
import { EcuSection } from '../../src/ui/components/ecu/EcuSection.jsx';
import { FIELD_TIPS, PAGE_GUIDES, tipFor } from '../../src/ui/components/ecu/guides.js';
import { SetupNote } from '../../src/ui/components/ecu/SetupNote.jsx';
import { InductionScreen } from '../../src/ui/screens/build/InductionScreen.jsx';
import { ACTIONS } from '../../src/ui/state/reducer.js';
import { StoreProvider, useBuild } from '../../src/ui/state/StoreProvider.jsx';

afterEach(cleanup);

const mount = (node) => render(<StoreProvider>{node}</StoreProvider>);

/** Fits a different wideband on BUILD, the way the BUILD picker does. */
function FitWideband({ id }) {
  const [build, dispatch] = useBuild();
  return (
    <button type="button" onClick={() => dispatch({
      type: ACTIONS.SET_BUILD_FIELD, field: 'sensorHw', value: { ...S.ecuHardwareOf(build).sensorHw, wideband: id },
    })}>fit-wideband</button>
  );
}

describe('sensorMismatches', () => {
  const cal = S.defaultEcuCalibration({});
  const fitted = S.DEFAULT_ECU_HW.sensorHw;

  it('finds nothing on the factory setup', () => {
    expect(S.sensorMismatches(fitted, cal)).toEqual([]);
  });

  it('names the part fitted, the setting, and the value that fixes it', () => {
    const [m] = S.sensorMismatches({ ...fitted, wideband: 'afr-10-20' }, cal);
    expect(m.path).toBe('sensors.wideband');
    expect(m.value).toBe('afr-10-20');
    expect(m.fitted).toMatch(/AFR 10–20/);
    expect(m.told).toMatch(/λ 0.50–1.50/);
  });

  it('treats the automatic MAP setting as always matching', () => {
    expect(S.sensorMismatches({ ...fitted, map: '1bar' }, cal)).toEqual([]);
    expect(S.sensorMismatches({ ...fitted, map: '1bar' }, S.setCal(cal, 'sensors.map', '3bar'))).toHaveLength(1);
  });
});

describe('setupMismatches', () => {
  const cal = S.defaultEcuCalibration({});
  const hw = (patch = {}) => ({ ...S.ecuHardwareOf({ octaneIdx: 0 }), ...patch });
  const paths = (h, c = cal) => S.setupMismatches(h, c).map((m) => m.path);

  it('finds nothing on the factory car', () => {
    expect(S.setupMismatches(hw(), cal)).toEqual([]);
  });

  it('flags a returnless rail the ECU does not correct for, and correcting a return rail', () => {
    const returnless = hw({ fuelSystem: { ...S.DEFAULT_ECU_HW.fuelSystem, regulator: 'returnless' } });
    const [m] = S.setupMismatches(returnless, cal);
    expect(m.path).toBe('injector.pressureComp');
    expect(S.setupMismatches(returnless, S.setCal(cal, 'injector.pressureComp', m.fix.value))).toEqual([]);
    expect(paths(hw(), S.setCal(cal, 'injector.pressureComp', 'manifold'))).toEqual(['injector.pressureComp']);
    expect(paths(hw(), S.setCal(cal, 'injector.pressureComp', 'sensor'))).toEqual([]);
  });

  it('knows a flex tank needs its sensor, and the sensor needs switching on', () => {
    const flex = S.ecuHardwareOf({ octaneIdx: 4, ethanolPct: 40 });
    expect(S.setupMismatches(flex, cal)[0].fix).toBeNull();
    const fitted = { ...flex, sensorHw: { ...flex.sensorHw, flex: true } };
    expect(S.setupMismatches(fitted, cal)[0].fix.value).toBe(true);
    expect(S.setupMismatches(fitted, S.setCal(cal, 'config.flexEnabled', true))).toEqual([]);
    expect(paths(hw(), S.setCal(cal, 'config.flexEnabled', true))).toEqual(['config.flexEnabled']);
  });

  it('flags a fuel type that is not the one in the tank', () => {
    expect(paths(S.ecuHardwareOf({ octaneIdx: 3 }), S.setCal(cal, 'config.stoichMode', 'gasoline'))).toEqual(['config.stoichMode']);
    expect(paths(S.ecuHardwareOf({ octaneIdx: 3 }), S.setCal(cal, 'config.stoichMode', 'e85'))).toEqual([]);
  });
});

describe('the sensor note on BUILD', () => {
  it('says the ECU matches, then flags a new part and fixes it in one tap', () => {
    mount(<><FitWideband id="afr-8.5-18" /><SetupNote paths={['sensors.wideband']} okText="The ECU is set up for this sensor." /></>);
    expect(screen.getByText('The ECU is set up for this sensor.')).toBeTruthy();
    fireEvent.click(screen.getByText('fit-wideband'));
    expect(screen.getByText(/but the ECU is set to/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Set ECU to match' }));
    expect(screen.getByText('The ECU is set up for this sensor.')).toBeTruthy();
  });
});

describe('the page guide', () => {
  it('says what the page is for and that nothing has been changed', () => {
    mount(<EcuSection section="idle" title="Idle" />);
    expect(screen.getByText(PAGE_GUIDES.idle.does)).toBeTruthy();
    expect(screen.getByText(/All factory settings/)).toBeTruthy();
  });

  it('counts a changed setting, and Factory puts it back', () => {
    mount(<EcuSection section="idle" title="Idle" />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase A/C idle-up' }));
    expect(screen.getByText(/1 setting changed from factory/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Factory/ }));
    expect(screen.getByText(/All factory settings/)).toBeTruthy();
  });

  it('lists a sensor mismatch on TUNE › SENSORS with its fix', () => {
    mount(<><FitWideband id="afr-10-20" /><EcuSection section="sensors" title="Sensors" /></>);
    fireEvent.click(screen.getByText('fit-wideband'));
    expect(screen.getByRole('alert').textContent).toMatch(/Wideband/);
    fireEvent.click(screen.getByRole('button', { name: 'Set ECU to match' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a short tip, with the full explanation one tap away', () => {
    mount(<EcuSection section="idle" title="Idle" />);
    expect(screen.getByText(FIELD_TIPS['idle.acAirAdd'], { exact: false })).toBeTruthy();
    const whys = screen.getAllByRole('button', { name: 'Why?' });
    fireEvent.click(whys[0]);
    expect(screen.queryAllByRole('button', { name: 'Why?' })).toHaveLength(whys.length - 1);
  });
});

describe('the guidance text', () => {
  it('has a guide for every page and a tip for every setting shown by default', () => {
    for (const section of new Set(S.ECU_META.map((m) => m.section))) expect(PAGE_GUIDES[section]).toBeTruthy();
    for (const m of S.ECU_META.filter((x) => !x.pro)) expect(FIELD_TIPS[m.path], m.path).toBeTruthy();
  });

  it('never points at a setting that does not exist', () => {
    const paths = new Set(S.ECU_META.map((m) => m.path));
    for (const p of Object.keys(FIELD_TIPS)) expect(paths.has(p), p).toBe(true);
  });

  it('falls back to the first sentence of the full explanation', () => {
    expect(tipFor({ path: 'nope', help: 'One thing. Then another.' })).toBe('One thing.');
  });
});

describe('the turbo kit on BUILD', () => {
  /** Sets a build field, the way BUILD's own controls do. */
  function SetBuild({ field, value, label }) {
    const [, dispatch] = useBuild();
    return <button type="button" onClick={() => dispatch({ type: ACTIONS.SET_BUILD_FIELD, field, value })}>{label}</button>;
  }

  it('says a turbo with no boost set only costs power, until a boost curve is set', () => {
    mount(<>
      <SetBuild field="turboOn" value label="turbo-on" />
      <SetBuild field="boostCurve" value={[0, 0, 3, 6, 8, 8, 8, 7]} label="set-boost" />
      <InductionScreen active onToggle={() => {}} />
    </>);
    expect(screen.queryByText(/boost target is 0 psi everywhere/)).toBeNull();
    fireEvent.click(screen.getByText('turbo-on'));
    expect(screen.getByText(/boost target is 0 psi everywhere/)).toBeTruthy();
    fireEvent.click(screen.getByText('set-boost'));
    expect(screen.queryByText(/boost target is 0 psi everywhere/)).toBeNull();
  });
});
