/**
 * Charge thermodynamics.
 *
 * Compressing air heats it. Real compressors are ~70% isentropically efficient, so
 * charge temperature rises faster than ideal. An intercooler recovers most of that
 * back toward ambient. Charge temperature then feeds BOTH air density (via the ideal
 * gas law) and knock margin — the same coupling that exists on a real engine.
 */

import {
  AMBIENT_K, BARO_KPA, COMP_ISEN_EFF, GAMMA_EXP, IC_EFFECTIVENESS, PSI_TO_KPA,
} from './constants.js';
import { COEFF } from './coefficients.js';
import { clamp } from './math.js';

/**
 * Intake charge temperature after compression and (optionally) intercooling.
 *
 * The day's air is an input, not a constant: `env` carries the ambient temperature and
 * barometric pressure the compressor starts from. Left out, it is the sea-level 25 °C
 * day the rest of the model was built on, so every existing caller is unchanged.
 *
 * @param {number} boostPsi gauge boost pressure, psi
 * @param {boolean} intercooler whether an intercooler is fitted
 * @param {{ambientK?: number, baroKpa?: number}} [env] ambient conditions
 * @returns {number} charge temperature, K
 */
export function chargeTempK(boostPsi, intercooler, env) {
  const ambientK = env?.ambientK ?? AMBIENT_K;
  const baroKpa = env?.baroKpa ?? BARO_KPA;
  if (boostPsi <= 0) return ambientK;
  const pressureRatio = (baroKpa + boostPsi * PSI_TO_KPA) / baroKpa;
  const tCompressed = ambientK * Math.pow(pressureRatio, GAMMA_EXP / COMP_ISEN_EFF);
  return intercooler ? ambientK + (tCompressed - ambientK) * (1 - IC_EFFECTIVENESS) : tCompressed;
}

/**
 * Fraction of the trapped cylinder contents that is burned gas left from last cycle.
 *
 * Internal EGR. The clearance volume cannot be emptied, and overlap lets more back in.
 * Load dominates: at part throttle the manifold is in vacuum while the port is near
 * atmospheric, so exhaust pushes back in during overlap. Under boost the fresh charge
 * scavenges instead. This is why a big-cam engine idles badly, why cruise tolerates
 * enormous advance, and why an engine knocks at 100 kPa that was happy at 40.
 *
 * @param {object} input
 * @param {number} input.mapKpa manifold absolute pressure, kPa
 * @param {number} input.empKpa exhaust manifold pressure, kPa
 * @param {number} input.overlapDeg valve overlap, crank degrees
 * @param {number} [input.compression] static compression ratio; sets the clearance
 *   volume, which is the floor this whole quantity rests on
 * @returns {number} residual mass fraction, 0..1
 */
export function residualFraction({
  mapKpa, empKpa, overlapDeg, compression = COEFF.RESIDUAL_CR_REF,
}) {
  // Pressure ratio across the cylinder during overlap. Above 1 the exhaust port is
  // pushing back in; below 1 the fresh charge is blowing through.
  const backflow = Math.pow(Math.max(0.05, empKpa / Math.max(1, mapKpa)), COEFF.RESIDUAL_LOAD_EXP);
  const overlapTerm = 1 + overlapDeg * COEFF.RESIDUAL_PER_OVERLAP_DEG;
  // The gas that cannot be expelled is what sits in the chamber at TDC, and that volume
  // is Vd/(CR-1) — so raising compression genuinely traps less of the last cycle.
  const clearanceTerm = (COEFF.RESIDUAL_CR_REF - 1) / Math.max(1.5, compression - 1);
  return clamp(
    COEFF.RESIDUAL_BASE * backflow * overlapTerm * clearanceTerm, 0, COEFF.RESIDUAL_MAX,
  );
}

/**
 * Charge temperature at intake valve close, after mixing with residual exhaust.
 *
 * What a sensor reads is not what the charge starts compression at: hot residual is
 * already in the cylinder. At light load, where residual fractions peak, this is worth
 * a hundred degrees, and it is the mixture the knock model needs.
 *
 * @param {number} intakeK incoming charge temperature, K
 * @param {number} residualFrac residual mass fraction
 * @returns {number} trapped charge temperature, K
 */
export function trappedChargeK(intakeK, residualFrac) {
  return intakeK * (1 - residualFrac) + COEFF.RESIDUAL_TEMP_K * residualFrac;
}

/**
 * Charge temperature drop as liquid fuel evaporates into it. The heat comes from the
 * charge, which is why a rich mixture is a knock-control tool rather than just margin on
 * lambda, and why E85 resists knock far beyond what its octane number explains.
 *
 * @param {number} fuelMassG fuel delivered to the cylinder, grams
 * @param {number} airMassG air trapped in the cylinder, grams
 * A blended fuel (a flex-fuel tank at, say, E40) carries its own `latentHeat`, mixed
 * from its components by mass; the four pump fuels do not, and fall back to the
 * gasoline/ethanol split on stoichiometric ratio they have always used.
 *
 * @param {{stoich: number, latentHeat?: number}} fuel
 * @returns {number} temperature drop, K
 */
export function evaporativeCoolingK(fuelMassG, airMassG, fuel) {
  const latent = fuel.latentHeat ?? (fuel.stoich < COEFF.FUEL_ETHANOL_STOICH_MAX
    ? COEFF.FUEL_LATENT_HEAT_ETHANOL : COEFF.FUEL_LATENT_HEAT_GASOLINE);
  const heatJ = (fuelMassG / 1000) * latent * COEFF.FUEL_EVAP_IN_CYLINDER;
  return heatJ / Math.max(1e-6, (airMassG / 1000) * COEFF.CHARGE_CP);
}

/**
 * The dew point of the fuel vapour in a charge, K: the temperature below which the fuel
 * could not all be vapour, because its saturation pressure would be less than the
 * partial pressure it exerts at the given total pressure. Below it the rest stays liquid
 * (see FUEL_VAPOUR_ANCHORS). `cycleInputsFor` asks it at the top of compression, which
 * is where the evaporation its charge cooling stands for has to be complete.
 *
 * @param {number} fuelMassG fuel delivered to the cylinder, grams
 * @param {number} airMassG air trapped in the cylinder, grams
 * @param {number} pressureKpa total pressure of the charge, kPa
 * @param {{stoich: number, ethanolPct?: number}} fuel
 * @returns {number} K
 */
export function fuelDewPointK(fuelMassG, airMassG, pressureKpa, fuel) {
  const ethanol = clamp((COEFF.STOICH_GASOLINE - fuel.stoich) / (COEFF.STOICH_GASOLINE - COEFF.STOICH_ETHANOL), 0, 1);
  const A = COEFF.FUEL_VAPOUR_ANCHORS;
  const i = ethanol <= A[1].ethanol ? 0 : 1;
  const t = (ethanol - A[i].ethanol) / (A[i + 1].ethanol - A[i].ethanol);
  const lnRvp = Math.log(A[i].rvpKpa) + t * (Math.log(A[i + 1].rvpKpa) - Math.log(A[i].rvpKpa));
  const b = A[i].b + t * (A[i + 1].b - A[i].b);
  const molarG = A[i].molarG + t * (A[i + 1].molarG - A[i].molarG);
  const fuelMol = fuelMassG / molarG;
  const airMol = Math.max(1e-12, airMassG) / COEFF.AIR_MOLAR_G;
  const partialKpa = Math.max(1e-9, pressureKpa * fuelMol / (fuelMol + airMol));
  return 1 / (1 / COEFF.FUEL_RVP_REF_K + (lnRvp - Math.log(partialKpa)) / b);
}

/**
 * Exhaust gas temperature for the TURBINE BALANCE, K.
 *
 * NOT the number the datalog reports as EGT — that comes from `runCycle`'s `exhaustK`,
 * measured off the integrated pressure trace and then cooled through the port. This
 * docstring claimed otherwise and was wrong (issue #47); the two have not been the same
 * call since the crank-angle cycle landed, and saying they were sent readers looking for
 * the EGT bug in the wrong file.
 *
 * This one exists because the turbine balance has to price the expansion BEFORE the
 * cycle can run — that is the fixed point it is solving — so it cannot use the cycle's
 * own answer and needs a correlation instead.
 *
 * Load raises it steeply then SATURATES — past a full charge, extra air brings extra
 * expansion work and a richer mixture too. Retard is the big term (burning fuel on the
 * way out of the port), and a rich mixture cools it, which is why over-fuelling protects
 * a turbine.
 *
 * @param {object} input
 * @param {number} input.chargeIndex how full the cylinder is, 1.0 at 100% VE and sea level
 * @param {number} input.lambda delivered lambda
 * @param {number} [input.knockRetardDeg] spark pulled by knock control
 * @returns {number} exhaust gas temperature, K
 */
export function exhaustTempK({ chargeIndex, lambda, knockRetardDeg = 0 }) {
  const loadRise = COEFF.EXHAUST_LOAD_SPAN_K
    * (1 - Math.exp(-Math.max(0, chargeIndex) / COEFF.EXHAUST_LOAD_SCALE));
  return COEFF.EXHAUST_BASE_K + loadRise
    + COEFF.EXHAUST_PER_RETARD_K * Math.max(0, knockRetardDeg)
    - COEFF.EXHAUST_RICH_COOLING_K * Math.max(0, 1 - lambda);
}

/**
 * The exhaust temperature the induction solve runs on, K.
 *
 * `solveInduction` prices the turbine's expansion before it knows how much air the engine
 * will draw — that is the fixed point it is solving — so it uses a full-charge,
 * stoichiometric reference. A real simplification, tolerable only because the saturating
 * load term above is nearly flat across the range a boosted engine works in.
 *
 * Defined once because three callers need it, and three inlined copies is how a model
 * ends up with three exhaust temperatures.
 */
export const INDUCTION_REF_EXHAUST_K = exhaustTempK({ chargeIndex: 1, lambda: 1 });
