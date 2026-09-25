/**
 * The pull log's entries for what the engine management did.
 *
 * Same contract as every other event in `sweep.js`: what happened, what physically
 * caused it, and what to change. An ECU event is always about the CALIBRATION or the
 * hardware the ECU reads — the engine itself is reported by the physics events.
 */

import { clamp, groupRuns } from '../math.js';

/**
 * How big a departure has to be before the pull log reports it — below these it is too
 * small to change a tuning decision, and reporting it would bury the entries that do.
 */
const REPORT = Object.freeze({
  /** Timing pulled for noise the sensor mistook for knock, degrees. */
  FALSE_KNOCK_DEG: 0.5,
  /** Knock left running because the sensor could not hear it, degrees. */
  UNHEARD_KNOCK_DEG: 0.3,
  /** Share of firing events that did not light, percent. */
  MISFIRE_PCT: 5,
  /** Gap between what the wideband reads and the true mixture, lambda. */
  WIDEBAND_MISREAD_LAMBDA: 0.03,
  /** Gap between the stoichiometric ratio the ECU assumes and the fuel's own, share. */
  STOICH_MISMATCH: 0.03,
});

/**
 * @param {object[]} points ECU sweep points
 * @param {object} ctx
 * @param {object} ctx.cal
 * @param {import('./strategy.js').EcuHardware} ctx.hw
 * @param {number} ctx.hardCut
 * @param {number} ctx.endRpm
 * @returns {object[]}
 */
export function ecuSweepEvents(points, { cal, hw, hardCut, endRpm }) {
  const events = [];
  if (!points.length) return events;
  const label = (run) => (run[0].rpm === run[run.length - 1].rpm ? `${run[0].rpm} RPM` : `${run[0].rpm}–${run[run.length - 1].rpm} RPM`);
  const frac = (run) => run.length / points.length;
  const imp = (base, run) => Math.max(3, Math.round(base * (0.3 + 0.7 * frac(run))));
  const span = (run) => ({ rpmStart: run[0].rpm, rpmEnd: run[run.length - 1].rpm });
  const has = (p, k) => (p.protect ?? []).includes(k);

  if (hardCut < endRpm) {
    events.push({
      type: 'limiter', severity: 2, impact: Math.round(clamp((endRpm - hardCut) / 60, 4, 20)),
      rpmStart: Math.round(hardCut), rpmEnd: endRpm,
      msg: `Rev limiter at ${Math.round(hardCut)} RPM ended the pull ${Math.round(endRpm - hardCut)} RPM short of redline`,
      cause: `The limiter is set ${Math.abs(cal.limiter.offsetRpm)} RPM ${cal.limiter.offsetRpm < 0 ? 'below' : 'above'} the BUILD redline, and it cuts ${cal.limiter.mode === 'spark' ? 'spark' : 'fuel'} there whatever the throttle says.`,
      fix: 'On TUNE → PROTECT, raise the hard cut toward the redline if the valvetrain is good for it.',
    });
  }

  groupRuns(points, (p) => has(p, 'limiter')).forEach((run) => {
    events.push({
      type: 'limiter', severity: 1, impact: imp(6, run), ...span(run),
      msg: `Soft limiter active across ${label(run)} (${cal.limiter.mode === 'retard' ? 'retarding' : `cutting up to ${Math.max(...run.map((p) => p.cutPct ?? 0))}% of events`})`,
      cause: `The soft window starts ${cal.limiter.softWindowRpm} RPM below the hard cut. ${cal.limiter.mode === 'spark' ? 'Spark-cut events dump unburned mixture into the manifold, where it lights — that is the heat and the pops.' : cal.limiter.mode === 'retard' ? 'Retard phases the burn late, so less work reaches the piston and more heat reaches the exhaust.' : 'Fuel-cut events pump cool air through, which is why this is the gentle strategy.'}`,
      fix: 'Narrow the soft window on PROTECT if it is eating into the power band.',
    });
  });

  groupRuns(points, (p) => has(p, 'overboost')).forEach((run) => {
    const peak = run.reduce((a, b) => (b.boostPsi > a.boostPsi ? b : a));
    events.push({
      type: 'overboost', severity: 3, impact: imp(16, run), ...span(run),
      msg: `Overboost protection tripped across ${label(run)} — boost reached past target + ${cal.boost.overboostMarginPsi} psi`,
      cause: `${cal.boost.mode === 'open' ? `Open-loop boost control holds whatever the base duty table's number holds. At ${peak.rpm} RPM that was ${peak.wgDutyBase}% duty, which holds more than the ${peak.boostTarget} psi target on this wastegate.` : 'The controller could not hold target — the wastegate ceiling is above it.'} The ECU ${cal.boost.overboostAction === 'fuel-cut' ? 'cut fuel' : 'opened the wastegate'} to protect the engine.`,
      fix: 'On TUNE → BOOST, lower the base duty in that region (or switch to closed loop) so the gate holds the target it is given.',
    });
  });

  groupRuns(points, (p) => p.gateLimited === 'spring').forEach((run) => {
    const peak = run[0];
    events.push({
      type: 'boostctl', severity: 1, impact: imp(6, run), ...span(run),
      msg: `Boost cannot be held down to target across ${label(run)} — the wastegate spring is stiffer than the target`,
      cause: `A pneumatic gate stays shut until boost reaches its spring pressure (${hw.gate?.springPsi} psi). The solenoid can only raise that, never lower it, so at ${peak.rpm} RPM a ${peak.boostTarget} psi target is unreachable from below.`,
      fix: 'Fit a softer wastegate spring on BUILD, or an electronic actuator, or raise the target to at least the spring pressure.',
    });
  });
  groupRuns(points, (p) => p.gateLimited === 'duty').forEach((run) => {
    events.push({
      type: 'boostctl', severity: 1, impact: imp(6, run), ...span(run),
      msg: `Wastegate at maximum duty across ${label(run)} — the target is beyond what the actuator can hold`,
      cause: `At ${cal.boost.maxDuty}% duty the gate still opens below the target. More duty is not available, so boost stops where the gate lets it.`,
      fix: 'Raise the maximum duty on TUNE → BOOST, fit a stiffer spring, or lower the target.',
    });
  });

  groupRuns(points, (p) => has(p, 'lean')).forEach((run) => {
    const peak = run.reduce((a, b) => (b.sensedLambda > a.sensedLambda ? b : a));
    const misread = Math.abs(peak.sensedLambda - (peak.lambdaExhaust ?? peak.lambda)) > REPORT.WIDEBAND_MISREAD_LAMBDA;
    events.push({
      type: 'leanprot', severity: 2, impact: imp(12, run), ...span(run),
      msg: `Lean protection intervened across ${label(run)} (wideband read λ ${peak.sensedLambda.toFixed(2)})`,
      cause: misread
        ? `The wideband READ λ ${peak.sensedLambda.toFixed(2)} but the mixture was actually λ ${(peak.lambdaExhaust ?? peak.lambda).toFixed(2)}: the ECU's wideband scaling does not match the controller fitted, so the protection is acting on a number that is wrong.`
        : `Under boost the mixture was leaner than the λ ${cal.protect.leanLambda} limit, so the ECU ${cal.protect.leanAction === 'fuel-cut' ? 'cut fuel' : cal.protect.leanAction === 'torque' ? 'closed the throttle' : 'took boost out'} to save the pistons.`,
      fix: misread ? 'On TUNE → SENSORS, set the wideband scaling to match the controller.'
        : (peak.nitrousLbMin ?? 0) > 0 ? 'It went lean while the nitrous sprayed: on TUNE → NITROUS, raise Fuel correction while spraying (and on a dry kit, Dry kit fuel). The protection saved the engine; it is not a tune.'
          : 'Find why it is lean — AFR table, VE, injector scaling, fuel pressure — and fix that. The protection saved the engine; it is not a tune.',
    });
  });

  groupRuns(points, (p) => has(p, 'egt')).forEach((run) => {
    const peak = run.reduce((a, b) => (b.egt > a.egt ? b : a));
    events.push({
      type: 'egtprot', severity: 1, impact: imp(6, run), ...span(run),
      msg: `Component protection enriching across ${label(run)} (EGT ${peak.egt} °C against a ${cal.protect.egtLimitC} °C limit)`,
      cause: `The exhaust was hotter than the ${hw.turboOn ? 'turbine and exhaust valves' : 'exhaust valves and catalytic converter'} are calibrated for, so the ECU added fuel. Extra fuel absorbs heat evaporating and leaves the burn cooler — at the cost of fuel and some power.${(peak.nitrousLbMin ?? 0) > 0 ? ' Nitrous raises exhaust heat on its own: more fuel burns every cycle, and the retard it needs finishes the burn later.' : ''}`,
      fix: (peak.nitrousLbMin ?? 0) > 0
        ? 'This is the protection doing its job on the heat nitrous brings. Keep the retard while spraying on TUNE → NITROUS to what the knock needs — more burns later and hotter in the exhaust — and hold the spray mixture near 11.5:1 rather than leaner.'
        : 'Hot exhaust usually means late combustion: check the spark in that range is not being pulled (knock) or commanded late. Richer AFR targets there do the same job deliberately.',
    });
  });

  // ---- NITROUS. What the kit did on this pull, in the terms a nitrous tuner reads it.
  const kit = hw.nitrous;
  if (kit && cal.nitrous) {
    const n = cal.nitrous;
    const spraying = (p) => (p.nitrousLbMin ?? 0) > 0;
    groupRuns(points, (p) => has(p, 'nitrous lean')).forEach((run) => {
      const inj = run.some((p) => p.fuelLimited);
      const pump = run.some((p) => p.fuelStarved);
      events.push({
        type: 'nitrouslean', severity: 3, impact: imp(18, run), ...span(run),
        msg: `Lean cut shut the nitrous off across ${label(run)} — the wideband read leaner than λ ${n.leanCutLambda.toFixed(2)} while spraying`,
        cause: kit.kit === 'dry'
          ? inj
            ? `A dry kit's fuel goes through the injectors, and on top of what the engine already needs they ran out of time: the nitrous got its oxygen and not its fuel.`
            : n.dryFuelPct < 100
              ? `This is a dry kit, so the ECU adds its fuel — and it is set to ${n.dryFuelPct}% of what a ${kit.shotHp} shot needs. The nitrous's oxygen had too little to burn with.`
              : `The dry-kit fuel is set for the rated shot, but the nitrous flowed more than rated here (a hot bottle pushes more through the jet), so the mixture went lean.`
          : pump
            ? `A wet kit's fuel jet runs off the same pump as the injectors. With the nitrous on, the pump could not hold rail pressure for both, and the kit's fuel fell with it while the nitrous did not.`
            : `A wet kit meters its fuel at a fixed fuel pressure, so it does not follow the bottle: more bottle pressure pushes more nitrous through the same fuel. The fuel pressure held here, so the bottle is the suspect — or the lean-cut limit is set tighter than the mixture the kit is jetted for.`,
        fix: kit.kit === 'dry'
          ? inj
            ? 'On BUILD → FUEL SYSTEM, fit larger injectors (then set TUNE → INJECTORS to match), or spray a smaller shot.'
            : 'On TUNE → NITROUS, raise the dry kit fuel to at least 100% for this shot.'
          : pump
            ? 'Fit a bigger fuel pump on BUILD → FUEL SYSTEM: it has to feed the engine and the kit together.'
            : `Bring the bottle to 85 °F (about 920 psi) with the heater on BUILD → INDUCTION, check the lean-cut limit on TUNE → NITROUS (λ ${n.leanCutLambda.toFixed(2)} now), or raise Fuel correction while spraying there.`,
      });
    });
    groupRuns(points, (p) => spraying(p) && p.knockPull > 0).forEach((run) => {
      const worst = Math.max(...run.map((p) => p.knockPull));
      events.push({
        type: 'nitrousknock', severity: 3, impact: imp(14, run), ...span(run),
        msg: `Knock while spraying across ${label(run)} (up to ${worst.toFixed(1)}° pulled)`,
        cause: `The nitrous's extra oxygen and heat raise cylinder pressure and temperature, so the knock limit drops while it flows. The retard while spraying is ${n.retardDeg}°; this engine needed about ${worst.toFixed(1)}° more on top of it here.`,
        fix: `On TUNE → NITROUS, raise the retard while spraying to about ${Math.ceil(n.retardDeg + worst)}°, or run higher-octane fuel on BUILD → FUEL SYSTEM. The rule of thumb is 2° per 50 hp of shot: ${Math.round(kit.shotHp / 25)}° for this ${kit.shotHp} shot.`,
      });
    });
    const sprayPts = points.filter(spraying);
    if (sprayPts.length) {
      const psi = sprayPts[0].bottlePsi;
      const shotShare = Math.round(Math.sqrt(Math.max(0, psi) / 950) * 100);
      if (psi < 850) {
        events.push({
          type: 'bottle', severity: 1, impact: imp(8, sprayPts), ...span(sprayPts),
          msg: `Bottle pressure only ${psi} psi — the jets flowed about ${shotShare}% of the rated shot`,
          cause: `Nitrous is stored as a liquid under its own vapour pressure, which is set by the bottle's temperature, not by how full it is. The jets are sized for about 950 psi; a cold bottle pushes less through them${kit.kit === 'wet' ? ', and a wet kit\'s fuel does not drop with it, so the nitrous mixture runs rich' : ''}.`,
          fix: 'On BUILD → INDUCTION, switch the bottle heater on: it holds about 85 °F, which is 920-950 psi.',
        });
      } else if (psi > 1000) {
        events.push({
          type: 'bottle', severity: 2, impact: imp(10, sprayPts), ...span(sprayPts),
          msg: `Bottle pressure ${psi} psi — hotter than the jets are sized for`,
          cause: `Past about 90 °F the bottle's pressure climbs fast toward nitrous's critical point (97.6 °F, ~1,050 psi). More pressure pushes more nitrous through the same jet${kit.kit === 'wet' ? ' but not more fuel, so a wet kit runs lean' : ''}.`,
          fix: 'Let the bottle cool to about 85 °F before the pass; a heater holds it there rather than above.',
        });
      }
    }
    if (n.minRpm < 2500 && kit.shotHp >= 100 && sprayPts.some((p) => p.rpm < 2500)) {
      const low = sprayPts.filter((p) => p.rpm < 2500);
      events.push({
        type: 'nitrouswindow', severity: 2, impact: imp(10, low), ...span(low),
        msg: `Spraying a ${kit.shotHp} shot from ${n.minRpm} RPM`,
        cause: 'Low in the rev range the engine moves little air, so the same shot is a far bigger share of the charge: cylinder pressure spikes, and a wet kit\'s fuel can pool in the intake and light — an intake backfire.',
        fix: 'On TUNE → NITROUS, start the window at 3,000 RPM or later for this shot.',
      });
    }
  }

  groupRuns(points, (p) => has(p, 'iat')).forEach((run) => {
    const peak = run.reduce((a, b) => (b.sensedIat > a.sensedIat ? b : a));
    const pulled = (peak.sensedIat - cal.protect.iatLimitC) * cal.protect.iatRetardPerC;
    events.push({
      type: 'iatprot', severity: 1, impact: imp(6, run), ...span(run),
      msg: `Intake-temperature protection pulling timing across ${label(run)} (intake air up to ${Math.round(peak.sensedIat)} °C against a ${cal.protect.iatLimitC} °C limit)`,
      cause: `Hot intake air knocks sooner, so the ECU takes ${cal.protect.iatRetardPerC}° of timing out for every degree over the limit — about ${pulled.toFixed(1)}° here, whatever the SPARK table says.`,
      fix: 'Cool the charge: fit an intercooler on BUILD → INDUCTION, or ask for less boost. Raising the limit on TUNE → PROTECT only removes the safety margin.',
    });
  });

  groupRuns(points, (p) => has(p, 'knock')).forEach((run) => {
    events.push({
      type: 'knockprot', severity: 2, impact: imp(10, run), ...span(run),
      msg: `Knock protection cut boost across ${label(run)}`,
      cause: `Knock control was pulling more than ${cal.protect.knockRetardDeg}° — running that much retard is hot and inefficient, so the ECU took ${cal.protect.knockBoostCutPsi} psi out as well.`,
      fix: 'Pull timing in those cells, richen, or lower the boost target so knock control is not doing the calibration\'s job.',
    });
  });

  groupRuns(points, (p) => has(p, 'duty')).forEach((run) => {
    events.push({
      type: 'dutyprot', severity: 2, impact: imp(8, run), ...span(run),
      msg: `Injector duty protection cut boost across ${label(run)}`,
      cause: `Duty passed ${cal.protect.dutyLimitPct}%. Beyond it the injectors cannot add fuel as boost adds air.`,
      fix: 'Larger injectors, or a fuel with less volume per unit of air.',
    });
  });

  groupRuns(points, (p) => has(p, 'torque')).forEach((run) => {
    const peak = run[0];
    events.push({
      type: 'torquelimit', severity: 1, impact: imp(6, run), ...span(run),
      msg: `Torque limited to ${peak.torqueLimitNm} Nm across ${label(run)} (by ${cal.torque.method})`,
      cause: cal.torque.method === 'spark'
        ? 'Spark retard took the torque out: the burn phases late, so less of it pushes the piston and more of it heats the exhaust.'
        : cal.torque.method === 'throttle' ? 'The throttle closed to hold torque at the limit — the cleanest way, less air and less fuel.'
          : cal.torque.method === 'boost' ? 'Boost was reduced to hold torque at the limit.' : 'Cylinders were cut to hold torque at the limit.',
      fix: 'The torque limits live on TUNE → TORQUE.',
    });
  });

  groupRuns(points, (p) => has(p, 'oil')).forEach((run) => {
    events.push({
      type: 'oilprot', severity: 3, impact: imp(20, run), ...span(run),
      msg: `Oil pressure protection cut fuel across ${label(run)}`,
      cause: `Oil pressure (${run[0].oilKpa} kPa) was below the minimum the calibration asks for at that speed.`,
      fix: 'Check the oil system, or the minimum-pressure curve on PROTECT if it is set above what a healthy hot engine makes.',
    });
  });

  groupRuns(points, (p) => has(p, 'fuelpressure') || p.fuelStarved).forEach((run) => {
    const peak = run.reduce((a, b) => (b.railDp < a.railDp ? b : a));
    events.push({
      type: 'rail', severity: 2, impact: imp(12, run), ...span(run),
      msg: `Fuel rail sagging across ${label(run)} — ${peak.railDp} kPa across the injectors`,
      cause: peak.fuelStarved
        ? `The engine wanted more fuel than the pump could supply (${peak.pumpLph} L/h at this pressure), so rail pressure fell until the injectors flowed only what the pump delivered. Every cylinder leans together.`
        : `The pressure across the injectors fell below ${cal.protect.fuelMinDeltaKpa} kPa. ${hw.fuelSystem?.regulator === 'returnless' ? 'On a returnless rail, boost pushes back on the injector tips: the rail is fixed above atmosphere, so every psi of boost is a psi less across the injector.' : ''}`,
      fix: peak.fuelStarved ? 'Fit a bigger fuel pump on BUILD → FUEL SYSTEM.' : 'Raise base fuel pressure, fit a return-style regulator, or turn on pressure compensation on TUNE → INJECTORS.',
    });
  });

  groupRuns(points, (p) => (p.knockFalse ?? 0) > REPORT.FALSE_KNOCK_DEG).forEach((run) => {
    const peak = run.reduce((a, b) => (b.knockFalse > a.knockFalse ? b : a));
    events.push({
      type: 'falseknock', severity: 2, impact: imp(14, run), ...span(run),
      msg: `False knock across ${label(run)} — the ECU retarded up to ${peak.knockFalse.toFixed(1)}° for valvetrain noise`,
      cause: `The knock sensor hears the valves closing as well as detonation, and that noise grows with the square of engine speed and with spring force. At ${peak.rpm} RPM the noise (${peak.knockNoise} V) crosses the threshold, so the ECU pulls timing from an engine that is not knocking.`,
      fix: 'On TUNE → SPARK, raise the knock threshold in that RPM range to just above the noise. Changing the cam or springs changes the noise — the threshold has to be re-learned after either.',
    });
  });

  groupRuns(points, (p) => (p.knockUnheard ?? 0) > REPORT.UNHEARD_KNOCK_DEG).forEach((run) => {
    const peak = run.reduce((a, b) => (b.knockUnheard > a.knockUnheard ? b : a));
    events.push({
      type: 'unheardknock', severity: 3, impact: imp(16, run), ...span(run),
      msg: `Knock the ECU could not hear across ${label(run)} — up to ${peak.knockUnheard.toFixed(1)}° past the limit, uncorrected`,
      cause: cal.ignition.knockEnabled
        ? 'The knock threshold sits so far above the sensor\'s signal that light-to-moderate detonation never crosses it. Nothing retards, and the engine keeps knocking.'
        : 'Knock control is switched off, so nothing retards the timing when the end gas autoignites.',
      fix: cal.ignition.knockEnabled ? 'Lower the knock threshold toward the noise floor on TUNE → SPARK, and pull timing in those cells.' : 'Turn knock control back on, and pull timing in those cells.',
    });
  });

  groupRuns(points, (p) => (p.misfire ?? 0) > REPORT.MISFIRE_PCT && !(p.cutPct > 0)).forEach((run) => {
    const peak = run.reduce((a, b) => (b.misfire > a.misfire ? b : a));
    const spark = peak.sparkKvNeed > peak.sparkKvHave - 2;
    events.push({
      type: 'misfire', severity: 3, impact: imp(18, run), ...span(run),
      msg: `Misfire across ${label(run)} (up to ${peak.misfire}% of events)`,
      cause: spark
        ? `The plug gap needs ${peak.sparkKvNeed} kV to break down at this cylinder pressure, and the coil can make ${peak.sparkKvHave} kV at this dwell. Boost and advance both raise the gas density at the gap, and it takes more voltage to arc through denser gas.`
        : `The mixture (λ ${peak.lambda}) is outside what a flame will cross — it lights at the plug and dies.`,
      fix: spark ? 'Close the plug gap, raise the dwell on TUNE → SPARK, or fit higher-output coils.' : 'Bring the mixture back toward λ 0.8–1.0 — check the fuel type the ECU assumes, the injector scaling and the AFR table.',
    });
  });

  const satRun = groupRuns(points, (p) => p.sensedMap < p.map - 6);
  satRun.forEach((run) => {
    const peak = run[run.length - 1];
    events.push({
      type: 'mapsensor', severity: 3, impact: imp(18, run), ...span(run),
      msg: `MAP reading wrong across ${label(run)} — ECU reads ${peak.sensedMap} kPa at a true ${peak.map} kPa`,
      cause: hw.sensorHw?.map === '1bar' && peak.map > 105
        ? 'A 1-bar MAP sensor cannot report boost: its output tops out at atmospheric. The ECU reads every boosted point as 100 kPa, so it fuels for the wrong air and uses the part-throttle rows of every table.'
        : 'The MAP scaling in the ECU does not match the sensor fitted, so every voltage is converted to the wrong pressure.',
      fix: 'Fit a sensor rated for your boost on BUILD, and make the ECU\'s MAP scaling on TUNE → SENSORS match it.',
    });
  });

  const stoichRun = points.filter((p) => p.ecuStoich && Math.abs(p.ecuStoich / hw.fuel.stoich - 1) > REPORT.STOICH_MISMATCH);
  if (stoichRun.length) {
    const p = stoichRun[0];
    events.push({
      type: 'fueltype', severity: 3, impact: Math.round(clamp(Math.abs(p.ecuStoich / hw.fuel.stoich - 1) * 60, 10, 36)),
      msg: `The ECU is fuelling for a ${p.ecuStoich}:1 fuel with a ${hw.fuel.stoich.toFixed(1)}:1 fuel in the tank`,
      cause: 'Fuel mass is air mass divided by lambda times the stoichiometric ratio. With the wrong ratio in the ECU every cylinder gets the wrong fuel, whatever the AFR table says.',
      fix: hw.flexTank
        ? 'This is a flex tank: fit the ethanol sensor on BUILD → FUEL SYSTEM and turn on "Use ethanol sensor" on TUNE → FUEL, so the ECU fuels for the blend it measures.'
        : 'On TUNE → FUEL, set the fuel the ECU assumes back to "Matches tank".',
    });
  }

  const wbMis = (hw.sensorHw?.wideband ?? 'lambda-0.5-1.5') !== cal.sensors.wideband
    && points.find((p) => p.openLoop === false && Math.abs(p.sensedLambda - (p.lambdaExhaust ?? p.lambda)) > REPORT.WIDEBAND_MISREAD_LAMBDA);
  if (wbMis) {
    events.push({
      type: 'wideband', severity: 2, impact: 10,
      msg: `Closed loop is holding the wideband READING on target while the mixture sits at λ ${wbMis.lambda}`,
      cause: 'The ECU converts the wideband\'s voltage with a different line from the one the controller outputs, so "λ 1.00" on its screen is not λ 1.00 in the exhaust. Closed loop trims until the reading agrees, which drives the real mixture off target.',
      fix: 'On TUNE → SENSORS, set the wideband scaling to match the controller fitted.',
    });
  }

  return events;
}
