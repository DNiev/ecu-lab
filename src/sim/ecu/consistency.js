/**
 * Where the ECU's settings contradict the hardware fitted on BUILD.
 *
 * Every entry is a setup a real car can be in and a real tuner has to catch: the part
 * changed and the ECU was not told, or the ECU was told something the part does not do.
 * Each one has a physical consequence the simulation already produces (a mis-read
 * sensor, a lean rail under boost, a flex tank fuelled as gasoline); this only names it
 * where the player makes the choice, instead of leaving it to be discovered on the dyno.
 *
 * Nothing here changes a setting. `fix` is the value that would resolve it, applied only
 * when the player asks.
 */

import { sensorMismatches } from './sensors.js';

/**
 * @typedef {object} SetupMismatch
 * @property {string} section the TUNE view the setting lives on
 * @property {string} path the calibration setting involved
 * @property {string} text what disagrees and what it does, in plain words
 * @property {{label: string, value: any}|null} fix the setting that resolves it, or null
 *   when only a hardware change on BUILD can
 */

/**
 * @param {{fuelSystem: {regulator: string}, sensorHw: {map?: string, wideband?: string, iat?: string,
 *   ect?: string, flex?: boolean}, flexTank?: boolean,
 *   ethanolPct?: number}} hw the ECU-side hardware of the build (`ecuHardwareOf`)
 * @param {{config: {stoichMode: string, flexEnabled: boolean}, injector: {pressureComp: string},
 *   sensors: Record<string, any>}} cal
 * @returns {SetupMismatch[]}
 */
export function setupMismatches(hw, cal) {
  const out = /** @type {SetupMismatch[]} */ ([]);

  for (const m of sensorMismatches(hw.sensorHw ?? {}, cal)) {
    out.push({
      section: 'sensors', path: m.path,
      text: `${m.what}: fitted ${m.fitted}, but the ECU is set to ${m.told}, so it will misread it.`,
      fix: { label: 'Set ECU to match', value: m.value },
    });
  }

  const returnless = hw.fuelSystem?.regulator === 'returnless';
  const comp = cal.injector.pressureComp;
  if (returnless && comp === 'none') {
    out.push({
      section: 'injectors', path: 'injector.pressureComp',
      text: 'The fuel rail is returnless, but the ECU does not correct for it. Under boost the injectors have less pressure behind them, flow less, and the engine runs lean.',
      fix: { label: 'Correct for fixed rail', value: 'manifold' },
    });
  } else if (!returnless && comp === 'manifold') {
    out.push({
      section: 'injectors', path: 'injector.pressureComp',
      text: 'The fuel rail is return-style, which already keeps injector pressure steady, but the ECU corrects as if it were fixed. It adds fuel under boost and removes it at idle that the engine does not need.',
      fix: { label: 'Stop correcting', value: 'none' },
    });
  }

  const sensor = !!hw.sensorHw?.flex;
  if (cal.config.flexEnabled && !sensor) {
    out.push({
      section: 'fuel', path: 'config.flexEnabled',
      text: '"Use ethanol sensor" is on, but no ethanol sensor is fitted on BUILD, so the ECU has nothing to read.',
      fix: { label: 'Turn it off', value: false },
    });
  } else if (hw.flexTank && sensor && !cal.config.flexEnabled) {
    out.push({
      section: 'fuel', path: 'config.flexEnabled',
      text: 'An ethanol sensor is fitted, but the ECU is not using it, so it fuels this flex tank as if it held gasoline.',
      fix: { label: 'Use the sensor', value: true },
    });
  } else if (hw.flexTank && !sensor && (hw.ethanolPct ?? 0) > 5) {
    out.push({
      section: 'fuel', path: 'config.flexEnabled',
      text: `This flex tank holds E${Math.round(hw.ethanolPct ?? 0)}, and with no ethanol sensor the ECU fuels it as gasoline, so it runs lean. Fitting the ethanol sensor (BUILD → FUEL SYSTEM) fixes it.`,
      fix: null,
    });
  }

  if (cal.config.stoichMode !== 'auto') {
    const e85Tank = !hw.flexTank && (hw.ethanolPct ?? 0) >= 85;
    const saysE85 = cal.config.stoichMode === 'e85';
    if (hw.flexTank || saysE85 !== e85Tank) {
      out.push({
        section: 'fuel', path: 'config.stoichMode',
        text: `The ECU is set for ${saysE85 ? 'E85' : 'gasoline'}, but the tank holds ${hw.flexTank ? `a flex blend (E${Math.round(hw.ethanolPct ?? 0)})` : e85Tank ? 'E85' : 'gasoline'}. Every cylinder gets the wrong amount of fuel.`,
        fix: { label: 'Match the tank', value: 'auto' },
      });
    }
  }

  return out;
}
