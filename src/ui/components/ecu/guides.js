/**
 * The plain-language layer over the engine management pages.
 *
 * `ECU_META` (src/sim/ecu/calibration.js) carries each setting's full explanation — the
 * physics of what it does. That is the right text for someone who wants to know WHY,
 * and too much for someone deciding WHETHER to touch it. This module is the second
 * kind of text: for each page, what it is for, when to come to it and when it is safe
 * to leave; for each setting a player sees without opening Advanced, one short line on
 * what it does and when it matters. The full explanation stays one tap away.
 *
 * Written to one rule: a player should finish reading and know what to do next, even
 * if that is "nothing — this is already right".
 */

/**
 * @typedef {object} PageGuide
 * @property {string} does what the page is for, in one sentence
 * @property {string} when the symptom that sends a player here
 * @property {string} leave why the factory setting is already safe
 */

/** @type {Record<string, PageGuide>} */
export const PAGE_GUIDES = {
  fuel: {
    does: 'Everything the ECU adds on top of your FUEL table: the fuel it thinks is in the tank, closed-loop trims, and extra fuel for cold starts and quick throttle stabs.',
    when: 'The log shows lean or rich only when cold or only on a sudden throttle opening, or you have switched to E85 or flex fuel.',
    leave: 'On factory settings a warm engine under load gets exactly what your FUEL table asks for. At part throttle the trims hold it on target, and a cold start or a throttle stab gets the extra fuel any real ECU adds.',
  },
  injectors: {
    does: 'What the ECU knows about its injectors: how long they take to open, and how fuel pressure changes how much they flow.',
    when: 'You fitted different injectors, or a returnless fuel system on a turbo engine and the log shows the mixture going lean under boost.',
    leave: 'With the stock fuel system these already match the hardware.',
  },
  spark: {
    does: 'Timing added or removed on top of your SPARK table, and how knock control listens and reacts.',
    when: 'The log shows knock retard on an engine that is not knocking (common after a cam or spring change), or knock the ECU did not catch.',
    leave: 'Every correction here starts at zero, so the ECU asks for exactly your SPARK table. Knock control and the protections can still take timing out; when they do, the log says so.',
  },
  airflow: {
    does: 'How the ECU works out how much air is going in, and how the pedal moves the throttle.',
    when: 'After an intake change the MAF reads wrong at some airflows but not others, or you have fitted cam phasers.',
    leave: 'The default is the same air model you have been tuning with all along.',
  },
  boost: {
    does: 'How the ECU asks for boost and drives the wastegate to get it. The BUILD boost curve is the target; this page is how it is reached.',
    when: 'The log shows boost overshooting its target, falling short of it, or wheelspin in the low gears.',
    leave: 'Closed loop with the factory duty table reaches the BUILD boost curve by itself, wherever the turbo can make it.',
  },
  vvt: {
    does: 'Where the cam phasers turn the camshafts at each speed and load.',
    when: 'Only once BUILD has cam phasers. A good first try: advance the intake cam 15–25° below 3500 RPM for more low-down torque, then pull and compare.',
    leave: 'At zero, a phased engine runs exactly like one with fixed cams.',
  },
  idle: {
    does: 'How the ECU holds the engine at idle by itself: air for slow drift, spark for quick dips, and extra air when the A/C or lights come on.',
    when: 'On LIVE the idle hunts up and down, dips when the A/C switches on, or stalls.',
    leave: 'The factory idle holds 800 RPM steadily.',
  },
  protect: {
    does: 'What the ECU does when something goes wrong: the rev limiter, lean and hot-exhaust protection, knock protection, limp mode.',
    when: 'The Pull Log says a protection stepped in (it names which one), or you want to move the rev limit.',
    leave: 'Keep protections on. When one trips it is pointing at a real problem in the tune or the hardware; fix that instead.',
  },
  sensors: {
    does: 'How the ECU turns each sensor\'s voltage back into a number. It has to match the part fitted on BUILD.',
    when: 'Every time you change a sensor on BUILD. Anything that does not match is listed here, with a button that fixes it.',
    leave: 'If nothing is listed, every sensor is read correctly.',
  },
  nitrous: {
    does: 'When the nitrous sprays — the RPM, throttle and coolant window — how much timing comes out while it does, the fuel the ECU adds or takes out while it sprays, and a progressive ramp-in.',
    when: 'As soon as a kit is fitted on BUILD, and whenever the Pull Log shows knock, a lean cut, or a rich or lean mixture while spraying.',
    leave: 'The starting settings suit a 100 shot on pump gas: on from 3,000 RPM, full throttle only, 4° out. Bigger shots need about 2° more for every 50 hp.',
  },
  torque: {
    does: 'Limits on how much torque the engine may make, by gear and RPM, plus traction control and launch control for the drag strip.',
    when: 'The drag strip shows wheelspin, or you want launch control or flat-foot shifting.',
    leave: 'The factory limits sit far above anything a build here makes, so they never act.',
  },
};

/**
 * One line per setting a player sees without opening Advanced: what it does, and when
 * it matters. Settings without an entry fall back to the first sentence of their full
 * explanation.
 * @type {Record<string, string>}
 */
export const FIELD_TIPS = {
  // FUEL
  'config.stoichMode': 'Which fuel the ECU fuels for. "Matches tank" follows the pump fuel on BUILD; a flex tank also needs the ethanol sensor, below.',
  'config.flexEnabled': 'Lets the ECU read the ethanol sensor and fuel for the real blend. Turn on with a flex-fuel tank and sensor fitted.',
  'fuel.closedLoop': 'Uses the wideband to hold the mixture on target at part throttle. Leave on.',
  'fuel.openLoopKpa': 'Above this load the ECU stops correcting and follows your FUEL table exactly, so it can run rich for power.',
  'fuel.warmup': 'Extra fuel while the engine is cold. Raise it if a cold engine runs lean or stumbles.',
  'fuel.afterStart': 'Extra fuel for the first seconds after starting. Raise it if the engine stumbles right after it catches.',
  'fuel.cranking': 'Fuel while the starter turns. Too little and it will not start; too much and it floods.',
  'fuel.accel': 'Extra fuel when you stab the throttle. Raise it if the log goes lean for a moment on a quick throttle opening.',
  'fuel.dfcoEnabled': 'Switches the injectors off when you lift off above idle. Saves fuel and gives engine braking.',
  'fuel.comp': 'A final percentage on the fuel, by RPM and load. 100 = no change. For the last few percent once the AIRFLOW table is right.',
  'fuel.targetDelayS': 'Delay before a richer target takes effect on a sudden throttle. Keep at zero on a turbo engine.',
  'fuel.cylTrim': 'Adds or removes fuel on one cylinder. Only does anything with cylinder modelling on (AIRFLOW page).',
  // INJECTORS
  'injector.deadTime': 'How long the injectors take to open at each battery voltage. Must match the injectors fitted.',
  'injector.minEffPwMs': 'The shortest squirt the ECU will ask for. Very short pulses deliver less than expected.',
  'injector.pressureComp': 'Corrects injector flow for fuel pressure. Set "Fixed rail" if BUILD has a returnless fuel system.',
  'injector.maxDutyPct': 'The longest the injectors may stay open each cycle. Past about 90% there is no time left, and the mixture goes lean.',
  // SPARK
  'ignition.iatCorr': 'Timing change by intake air temperature. Take timing out at high temperatures to protect a hot engine.',
  'ignition.ectCorr': 'Timing change by coolant temperature.',
  'ignition.baroCorr': 'Timing change by air pressure, for altitude.',
  'ignition.flexAdd': 'Extra timing on E85, blended in by the measured ethanol content. Ethanol resists knock.',
  'ignition.cylTrim': 'Timing change on one cylinder, to calm a single knocking cylinder. Needs cylinder modelling on.',
  'ignition.oilCorr': 'Timing change by oil temperature, a stand-in for how hot the pistons are.',
  'ignition.crankingDeg': 'Fixed timing while the starter turns the engine.',
  'ignition.dwell': 'How long the coil charges before each spark. Too little and the spark can fail under boost.',
  'ignition.knockEnabled': 'Lets the ECU take timing out when it hears knock. Leave on.',
  'ignition.knockThreshold': 'How loud a noise must be to count as knock. After a cam or spring change, raise it if the ECU hears "knock" that is not there.',
  'ignition.highDetRetard': 'After heavy knock, the ECU drops to safer timing by this much until things calm down. Zero turns it off.',
  // AIRFLOW
  'config.airModel': 'How the ECU works out air: from pressure and the AIRFLOW table, from the airflow sensor, or both. Leave on the default.',
  'config.cylinderModel': 'Works out each cylinder on its own, so they can differ. Turn on to use per-cylinder trims.',
  'airflow.mafTrim': 'Corrects the airflow sensor at specific airflows, after an intake change.',
  'airflow.camVeCorr': 'Corrects the AIRFLOW table as the cam phaser moves. Needs cam phasers.',
  'airflow.pedalMap': 'How far the throttle opens for each pedal position. Changes feel, not power.',
  // BOOST
  'boost.mode': 'Closed loop steers boost onto the target. Open loop just follows the duty table.',
  'boost.throttleScale': 'How much of the boost target you get at each throttle position.',
  'boost.gearLimit': 'The most boost allowed in each gear. Lower 1st and 2nd if the car spins its tyres.',
  'boost.iatComp': 'Takes boost away as the intake air gets hot.',
  'boost.baseDuty': 'The wastegate duty the ECU starts from for each boost target. Get this close and boost arrives cleanly.',
  'boost.kp': 'How hard the ECU reacts to a boost error right now. Too high and boost oscillates.',
  'nitrous.minRpm': 'Nitrous opens above this speed. Too low and a big shot breaks parts or backfires.',
  'nitrous.maxRpm': 'Nitrous shuts off above this. Keep it under the rev limiter.',
  'nitrous.minTpsPct': 'Nitrous only at this much throttle or more.',
  'nitrous.minEctC': 'No nitrous on a cold engine.',
  'nitrous.retardDeg': 'Timing taken out while spraying. About 2° per 50 hp of shot.',
  'nitrous.dryFuelPct': 'The fuel a dry kit needs, added through the injectors. 100% matches the shot.',
  'nitrous.fuelTrimPct': 'Injector fuel added or removed while spraying. Wet kits usually need some taken out.',
  'nitrous.startPct': 'How much of the shot comes in at once. 100% is on/off.',
  'nitrous.rampS': 'Seconds to bring the shot from its start to full.',
  'nitrous.leanCutEnabled': 'Shuts the nitrous off if the mixture goes lean while spraying.',
  'nitrous.leanCutLambda': 'How lean the wideband must read to cut the nitrous.',
  'boost.ki': 'How much the ECU builds up a correction over time. Too high and boost overshoots when the turbo spools.',
  'boost.overboostEnabled': 'Steps in if boost goes well over target. Leave on.',
  'boost.overboostMarginPsi': 'How far over target boost may go before overboost protection acts.',
  'boost.overboostAction': 'What overboost protection does: open the wastegate, or cut fuel.',
  // VVT
  'vvt.intakeTarget': 'How far the intake cam is advanced. Advance at low RPM for low-down torque; less at high RPM.',
  'vvt.exhaustTarget': 'How far the exhaust cam is retarded.',
  'vvt.rateDegS': 'How fast the phaser can move the cam.',
  'vvt.gain': 'How hard the ECU drives the cam to its target. Too high and it overshoots.',
  // IDLE
  'idle.target': 'Idle speed by coolant temperature. Cold engines usually idle higher.',
  'idle.baseAir': 'Where the idle valve starts. Close to right means a steady idle straight after starting.',
  'idle.gainUp': 'How quickly the ECU adds air when idle drops. Too slow stalls; too fast hunts.',
  'idle.sparkGain': 'How much the ECU uses timing to catch quick idle dips.',
  'idle.sparkLimit': 'The most timing idle control may add or remove.',
  'idle.acRpmAdd': 'Raises idle while the A/C is on.',
  'idle.acAirAdd': 'Extra air the moment the A/C switches on, so idle does not dip.',
  'idle.elecAirAdd': 'Extra air when the lights or other big electrical loads come on.',
  // PROTECT
  'limiter.mode': 'How the rev limiter cuts: fuel cut is smooth, spark cut pops and bangs.',
  'limiter.offsetRpm': 'Where the rev limiter sits compared with the BUILD redline.',
  'limiter.softWindowRpm': 'Eases the engine onto the rev limit instead of bouncing off it.',
  'limiter.throttleCutRpm': 'Starts closing the throttle this far before the limit, for a smoother limit.',
  'limiter.speedLimitKph': 'Cuts fuel above this road speed. Zero turns it off.',
  'protect.fanOnC': 'Coolant temperature at which the radiator fan switches on.',
  'protect.leanEnabled': 'Cuts boost or fuel if the mixture goes lean under boost. Leave on.',
  'protect.leanLambda': 'How lean the wideband must read before lean protection acts.',
  'protect.leanAction': 'What lean protection does about it.',
  'protect.egtEnabled': 'Adds fuel to cool the exhaust when it gets too hot. Leave on.',
  'protect.egtLimitC': 'Exhaust temperature at which extra fuel starts.',
  'protect.knockEnabled': 'Takes boost out when knock control is pulling a lot of timing.',
  'protect.knockRetardDeg': 'How much knock retard triggers the boost cut.',
  'protect.iatEnabled': 'Takes timing out when the intake air gets very hot.',
  'protect.iatLimitC': 'Intake air temperature at which that starts.',
  'protect.ectEnabled': 'Limp mode if the engine overheats: less throttle, no boost, a lower rev limit.',
  'protect.ectLimitC': 'Coolant temperature that triggers limp mode.',
  'protect.oilEnabled': 'Cuts fuel if oil pressure drops too low. Leave on.',
  'protect.oilMinKpa': 'The lowest safe oil pressure at each RPM.',
  'protect.fuelPressEnabled': 'Limp mode if fuel pressure collapses.',
  'protect.dutyEnabled': 'Takes boost out when the injectors are nearly flat out.',
  'protect.sensorLimp': 'Limp mode when a sensor fails. Leave on.',
  'protect.limpRpm': 'Rev limit in limp mode.',
  'protect.limpThrottlePct': 'Most throttle allowed in limp mode.',
  // TORQUE
  'torque.limitByGear': 'The most torque allowed in each gear, in newton-metres at the crank.',
  'torque.limitByRpm': 'The most torque allowed at each RPM.',
  'torque.method': 'How torque is taken away when a limit is hit. Spark is fastest but heats the exhaust.',
  'torque.tcEnabled': 'Takes torque away when the driven tyres spin. For the drag strip.',
  'torque.tcSlipPct': 'How much wheelspin traction control allows. Tyres grip best with a little.',
  'torque.tcGain': 'How hard traction control reacts to extra wheelspin.',
  'torque.tcMethod': 'How traction control takes torque away. Faster methods catch wheelspin sooner.',
  'arc.launchEnabled': 'Holds the engine at a set RPM on the start line while you hold the throttle down.',
  'arc.launchRpm': 'The RPM launch control holds.',
  'arc.launchTiming': 'Timing while launch control holds. Very late timing heats the exhaust and helps a turbo spool.',
  'arc.ffsEnabled': 'Shift without lifting off the throttle. Makes manual shifts quicker.',
  // SENSORS
  'sensors.map': 'Must match the MAP sensor on BUILD. "Auto" always matches.',
  'sensors.wideband': 'Must match the wideband controller on BUILD.',
  'sensors.iat': 'Must match the intake air temperature sensor on BUILD.',
  'sensors.ect': 'Must match the coolant temperature sensor on BUILD.',
  'sensors.tpsClosedV': 'Throttle sensor voltage the ECU treats as closed. Must match the part.',
  'sensors.tpsOpenV': 'Throttle sensor voltage the ECU treats as fully open. Must match the part.',
};

/**
 * The short line to show for a setting.
 * @param {{path: string, help: string}} meta
 * @returns {string}
 */
export function tipFor(meta) {
  if (FIELD_TIPS[meta.path]) return FIELD_TIPS[meta.path];
  const m = meta.help.match(/^(.+?[.!?])\s+(?=[A-Z"“(0-9])/);
  return m ? m[1] : meta.help;
}
