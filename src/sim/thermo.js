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

/** Universal gas constant, J/(mol K). */
const R_UNIVERSAL = 8.314462;

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
 * @param {number} [isenEff] the compressor's adiabatic efficiency, for a supercharger;
 *   absent, the turbo's fixed polytropic figure
 * @returns {number} charge temperature, K
 */
export function chargeTempK(boostPsi, intercooler, env, isenEff = null) {
  const ambientK = env?.ambientK ?? AMBIENT_K;
  const baroKpa = env?.baroKpa ?? BARO_KPA;
  if (boostPsi <= 0) return ambientK;
  const pressureRatio = (baroKpa + boostPsi * PSI_TO_KPA) / baroKpa;
  // Isentropic compression, degraded by the compressor's efficiency. The turbo keeps the
  // one fixed efficiency it always had (see docs/accuracy.md); a supercharger passes its
  // own, which is how a Roots blower heats the charge more than a twin-screw at equal boost.
  const tCompressed = isenEff == null
    ? ambientK * Math.pow(pressureRatio, GAMMA_EXP / COMP_ISEN_EFF)
    : ambientK * (1 + (Math.pow(pressureRatio, GAMMA_EXP) - 1) / isenEff);
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
 * Charge temperature drop as liquid fuel evaporates into it. What part of the heat comes
 * from the charge depends on where the fuel is sprayed: most of it in a direct-injected
 * cylinder, little of it in a port-injected one, whose fuel boils off the hot valve.
 * That is why E85 resists knock far beyond what its octane number explains, and does so
 * most on a direct-injected engine.
 *
 * @param {number} fuelMassG fuel delivered to the cylinder, grams
 * @param {number} airMassG air trapped in the cylinder, grams
 * A blended fuel (a flex-fuel tank at, say, E40) carries its own `latentHeat`, mixed
 * from its components by mass; the four pump fuels do not, and fall back to the
 * gasoline/ethanol split on stoichiometric ratio they have always used.
 *
 * @param {{stoich: number, latentHeat?: number}} fuel
 * @param {number} [share] share of the latent heat drawn from the charge rather than from
 *   the port and valve: the engine's `evapInCylinder`, set by where its injectors spray
 * @returns {number} temperature drop, K
 */
export function evaporativeCoolingK(fuelMassG, airMassG, fuel, share = COEFF.FUEL_EVAP_IN_CYLINDER_PORT) {
  const latent = fuel.latentHeat ?? (fuel.stoich < COEFF.FUEL_ETHANOL_STOICH_MAX
    ? COEFF.FUEL_LATENT_HEAT_ETHANOL : COEFF.FUEL_LATENT_HEAT_GASOLINE);
  const heatJ = (fuelMassG / 1000) * latent * share;
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
 * The products of burning a kg of fuel at a mixture, moles of each species, from the element
 * balance alone (no dissociation): lean, the surplus oxygen comes through as O2; rich, the
 * oxygen shortfall is left as CO and H2, split by the water-gas shift (COEFF.WATER_GAS_K,
 * Heywood 1988 section 4.9). Fuel is gasoline (CH1.87) and ethanol blended by mass, the
 * ethanol share read from stoichiometric ratio as `fuelDewPointK` reads it.
 *
 * @param {number} phi fuel-air equivalence ratio (1 / lambda)
 * @param {{stoich: number}} fuel
 * @returns {{CO2: number, CO: number, H2O: number, H2: number, O2: number, N2: number}}
 */
export function combustionProducts(phi, fuel) {
  const e = clamp((COEFF.STOICH_GASOLINE - fuel.stoich) / (COEFF.STOICH_GASOLINE - COEFF.STOICH_ETHANOL), 0, 1);
  // Moles of each element per kg of fuel.
  const gasMolC = 1000 / (12.011 + 1.008 * COEFF.GASOLINE_H_TO_C);
  const ethMol = 1000 / 46.069;
  const nC = (1 - e) * gasMolC + e * 2 * ethMol;
  const nH = (1 - e) * gasMolC * COEFF.GASOLINE_H_TO_C + e * 6 * ethMol;
  const nO = e * ethMol;
  // O2 that complete combustion needs, and what the air at this mixture brings.
  const o2Need = nC + nH / 4 - nO / 2;
  const o2Air = o2Need / Math.max(0.05, phi);
  const n2 = o2Air * COEFF.AIR_N2_PER_O2;
  if (!(phi > 1)) return { CO2: nC, CO: 0, H2O: nH / 2, H2: 0, O2: o2Air - o2Need, N2: n2 };
  // Each oxygen atom missing is a CO where there would have been CO2, or an H2 where there
  // would have been water. With b moles of CO and (missing - b) of H2, the shift constant
  // K = [CO][H2O] / ([CO2][H2]) is a quadratic in b; the root inside the element balance.
  const missing = Math.min(2 * o2Need * (1 - 1 / phi), nC + nH / 2);
  const K = COEFF.WATER_GAS_K;
  const qa = 1 - K;
  const qb = nH / 2 - missing + K * (nC + missing);
  const qc = -K * nC * missing;
  const b = clamp((-qb + Math.sqrt(qb * qb - 4 * qa * qc)) / (2 * qa), 0, Math.min(nC, missing));
  const d = missing - b;
  return { CO2: nC - b, CO: b, H2O: nH / 2 - d, H2: d, O2: 0, N2: n2 };
}

/**
 * Share of a fuel's heating value a flame actually releases at a given mixture, from the
 * products' chemistry rather than a fitted curve.
 *
 * Lean and stoichiometric, every carbon and hydrogen finds oxygen: 1. Rich, the oxygen runs
 * out, and the shortfall is left as CO and H2 (combustionProducts). Counting that as "the
 * fuel up to stoichiometric burns, the rest does not" overstates the heat, because the
 * oxygen there is does not all go to the products that pay best: taking a carbon only as
 * far as CO pays 283 kJ per mole of O2 where taking it on to CO2 pays 787. For gasoline at
 * 11:1 the flame releases about two thirds of the fuel's energy, against three quarters
 * under the stoichiometric cap, and that is why a rich mixture runs the exhaust cooler on a
 * real engine.
 *
 * @param {number} phi fuel-air equivalence ratio (1 / lambda)
 * @param {{stoich: number, lhv: number}} fuel
 * @returns {number} energy released over the delivered fuel's heating value, 0-1
 */
export function richHeatReleased(phi, fuel) {
  if (!(phi > 1)) return 1;
  const pr = combustionProducts(phi, fuel);
  const lostJ = pr.CO * COEFF.CO_LHV_J_PER_MOL + pr.H2 * COEFF.H2_LHV_J_PER_MOL;
  return clamp(1 - lostJ / fuel.lhv, 0, 1);
}

/**
 * Share of the delivered fuel's heating value the charge releases at a mean mixture, once
 * the mixture's own unevenness is counted.
 *
 * No real charge is the same mixture everywhere: fuel films, imperfect vaporisation and
 * cylinder-to-cylinder spread leave some pockets richer and some leaner than the mean. The
 * rich pockets lose energy to CO and H2 (richHeatReleased) while the lean pockets cannot
 * use the oxygen they carry. That is why a stoichiometric engine's exhaust holds about half
 * a percent each of CO and O2 at once, which a perfectly mixed charge never could (Heywood
 * 1988, section 4.9, exhaust composition). The spread is taken as normal in equivalence
 * ratio with COEFF.MIXTURE_PHI_SPREAD, the width that reproduces those measured
 * concentrations: 0.06 gives 0.5% O2 and 0.7% CO at a stoichiometric mean.
 *
 * Its effect is to round the corner at stoichiometric: the heat per kg of air peaks a
 * little rich of it (near lambda 0.95) rather than exactly on it, and the exhaust peaks
 * near lambda 1 instead of falling away on both sides of a sharp point.
 *
 * @param {number} phi mean fuel-air equivalence ratio (1 / lambda)
 * @param {{stoich: number, lhv: number}} fuel
 * @returns {number} energy released over the delivered fuel's heating value, 0-1
 */
export function heatReleasedShare(phi, fuel) {
  const sigma = COEFF.MIXTURE_PHI_SPREAD;
  // Fuel-weighted average over the pockets, midpoint rule across +-3.5 sigma.
  const N = 40;
  let released = 0;
  let delivered = 0;
  for (let i = -N; i <= N; i++) {
    const z = (i * 3.5) / N;
    const w = Math.exp(-z * z / 2);
    const local = Math.max(0.05, phi + sigma * z);
    released += w * local * richHeatReleased(local, fuel);
    delivered += w * local;
  }
  return released / delivered;
}

/**
 * How far the burned gas's ratio of specific heats sits from COEFF.GAMMA_BURNED at this
 * mixture: the products' own heat capacity (JANAF molar cp at the burned-gas reference
 * temperature, COEFF.PRODUCT_CP_J_MOL_K) relative to the stoichiometric products the
 * constant stands for.
 *
 * Stoichiometric products are the most triatomic — every carbon a CO2, every hydrogen a
 * water — and triatomic gas soaks heat into vibration, so it has the lowest gamma. A rich
 * mix swaps some of them for diatomic CO and H2, a lean one dilutes them with O2, and both
 * expand a little more efficiently per unit of heat. It is part of why best power sits a
 * little rich of stoichiometric even though a rich flame releases less heat.
 *
 * @param {number} phi fuel-air equivalence ratio (1 / lambda)
 * @param {{stoich: number}} fuel
 * @returns {number} added to COEFF.GAMMA_BURNED
 */
export function burnedGammaShift(phi, fuel) {
  const gammaOf = (pr) => {
    let mol = 0;
    let cp = 0;
    for (const [k, n] of Object.entries(pr)) { mol += n; cp += n * COEFF.PRODUCT_CP_J_MOL_K[k]; }
    const cpm = cp / mol;
    return cpm / (cpm - R_UNIVERSAL);
  };
  return gammaOf(combustionProducts(phi, fuel)) - gammaOf(combustionProducts(1, fuel));
}

/**
 * The products of a kg of CHARGE (fuel plus its air) at a mixture, moles of each species:
 * `combustionProducts` per kg of fuel, scaled by the fuel's share of the charge. The burned
 * zone of the cycle carries this composition.
 *
 * @param {number} phi fuel-air equivalence ratio
 * @param {{stoich: number}} fuel
 */
export function productsPerKgCharge(phi, fuel) {
  const pr = combustionProducts(phi, fuel);
  const fuelShare = 1 / (1 + fuel.stoich / Math.max(0.05, phi));
  /** @type {Record<string, number>} */
  const out = {};
  for (const [k, n] of Object.entries(pr)) out[k] = n * fuelShare;
  // The mixture, for the dissociation grid (dissociatedEnergyFast).
  return /** @type {{CO2: number, CO: number, H2O: number, H2: number, O2: number, N2: number, phi: number, stoich: number}} */ ({ ...out, phi, stoich: fuel.stoich });
}

/** ln Kp at a temperature, linear in 1/T between the tabulated points (ln Kp is near-linear in 1/T). */
const lnKpAt = (table, tK, T = COEFF.DISSOC_T_K) => {
  const inv = 1 / tK;
  if (tK <= T[0]) return table[0] + (table[1] - table[0]) * (inv - 1 / T[0]) / (1 / T[1] - 1 / T[0]);
  for (let i = 1; i < T.length; i++) {
    if (tK <= T[i]) return table[i - 1] + (table[i] - table[i - 1]) * (inv - 1 / T[i - 1]) / (1 / T[i] - 1 / T[i - 1]);
  }
  const n = T.length - 1;
  return table[n - 1] + (table[n] - table[n - 1]) * (inv - 1 / T[n - 1]) / (1 / T[n] - 1 / T[n - 1]);
};

/**
 * Energy the burned gas holds back in dissociated CO and H2 at a temperature and pressure,
 * J per kg of burned gas: the equilibria CO2 <-> CO + 1/2 O2 and H2O <-> H2 + 1/2 O2 solved
 * together on top of the element-balance products (`productsPerKgCharge`). Released again
 * as the gas cools (recombination), so the cycle subtracts the change in it from the heat
 * the flame adds at each step. See COEFF.DISSOC_LN_KP_CO2 for the source and what is left
 * out.
 *
 * @param {{CO2: number, CO: number, H2O: number, H2: number, O2: number, N2: number}} pr moles per kg
 * @param {number} tK burned-gas temperature
 * @param {number} pPa pressure
 * @returns {number} J per kg of burned gas
 */
export function dissociatedEnergyJPerKg(pr, tK, pPa) {
  if (!(tK > COEFF.DISSOC_MIN_K)) return 0;
  const k1 = Math.exp(lnKpAt(COEFF.DISSOC_LN_KP_CO2, tK));
  const k2 = Math.exp(lnKpAt(COEFF.DISSOC_LN_KP_H2O, tK));
  const k3 = Math.exp(lnKpAt(COEFF.DISSOC_LN_KP_OH, tK, COEFF.DISSOC_OH_T_K));
  const pAtm = pPa / 101325;
  const n0 = pr.CO2 + pr.CO + pr.H2O + pr.H2 + pr.O2 + pr.N2;
  // Extents: x splits CO2 into CO + 1/2 O2, y splits water into H2 + 1/2 O2, z splits water
  // into OH + 1/2 H2. Given the free O2, each equilibrium is linear in its own extent, so
  // the whole solve is one unknown: the O2 the extents themselves release must equal the O2
  // assumed. That balance is monotonic, so it is bisected in log space (the O2 runs from
  // parts per billion in a rich flame to percent lean). Same answers as solving the three
  // together; about twenty times cheaper, which matters at every crank step of every pull.
  const nt0 = n0;
  const extentsAt = (o2) => {
    const sO2 = Math.sqrt(o2 * pAtm / nt0);
    const x = clamp((k1 * pr.CO2 - pr.CO * sO2) / (sO2 + k1), 0, pr.CO2);
    let y = 0;
    let z = 0;
    for (let k = 0; k < 3; k++) {
      y = clamp((k2 * (pr.H2O - z) - (pr.H2 + z / 2) * sO2) / (sO2 + k2), 0, Math.max(0, pr.H2O - z));
      const sH2 = Math.sqrt(Math.max(1e-30, pr.H2 + y + z / 2) * pAtm / nt0);
      z = clamp((k3 * (pr.H2O - y)) / (sH2 + k3), 0, Math.max(0, pr.H2O - y));
    }
    return { x, y, z };
  };
  let lo = Math.log(Math.max(1e-12, pr.O2 + 1e-12));
  let hi = Math.log(pr.O2 + pr.CO2 + pr.H2O + 1e-9);
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    const o2 = Math.exp(mid);
    const e = extentsAt(o2);
    if (pr.O2 + (e.x + e.y) / 2 > o2) lo = mid; else hi = mid;
  }
  const { x, y, z } = extentsAt(Math.exp((lo + hi) / 2));
  return x * COEFF.CO_LHV_J_PER_MOL + y * COEFF.H2_LHV_J_PER_MOL + z * COEFF.OH_DISSOC_J_PER_MOL;
}

/** Nodes of the cached dissociation grid: temperature step, K, and pressure step in ln(Pa). */
const DISSOC_T_STEP_K = 25;
const DISSOC_LNP_STEP = 0.1;
/** Solved grid nodes per mixture: a lazily filled grid, NaN until a node is first needed. Bounded. */
const dissocCache = new Map();
const DISSOC_T_NODES = 72;      // 1700-3500 K
const DISSOC_P_NODE0 = 92;      // ln(1e4 Pa) / 0.1
const DISSOC_P_NODES = 82;      // up to ~350 bar
const DISSOC_PHI_STEP = 0.01;

/**
 * `dissociatedEnergyJPerKg` read off a grid of solved nodes (25 K, 10 % in pressure, 0.01 in
 * equivalence ratio) by interpolation, each node solved once. The cycle asks at every crank
 * step of every cycle of every pull; within a mixture the held energy is smooth in
 * temperature and pressure, so the grid reproduces the solve to within about a percent of
 * the energy held (itself a few percent of the heat) and costs a pull almost nothing.
 *
 * @param {{CO2: number, CO: number, H2O: number, H2: number, O2: number, N2: number, phi?: number, stoich?: number}} pr
 *   the burned gas, with its mixture (productsPerKgCharge sets `phi` and `stoich`)
 * @param {number} tK
 * @param {number} pPa
 */
export function dissociatedEnergyFast(pr, tK, pPa) {
  if (!(tK > COEFF.DISSOC_MIN_K) || pr.phi == null) return dissociatedEnergyJPerKg(pr, tK, pPa);
  const ft = (tK - COEFF.DISSOC_MIN_K) / DISSOC_T_STEP_K;
  const fp = Math.log(Math.max(1e4, pPa)) / DISSOC_LNP_STEP - DISSOC_P_NODE0;
  const fq = pr.phi / DISSOC_PHI_STEP;
  const i = Math.floor(ft); const j = Math.floor(fp); const q = Math.floor(fq);
  if (i < 0 || j < 0 || q < 1 || i + 1 >= DISSOC_T_NODES || j + 1 >= DISSOC_P_NODES) return dissociatedEnergyJPerKg(pr, tK, pPa);
  const gridOf = (qq) => {
    const key = qq * 1000 + Math.round(pr.stoich * 10);
    let grid = dissocCache.get(key);
    if (!grid) {
      if (dissocCache.size > 2000) dissocCache.clear();
      grid = { pr: productsPerKgCharge(qq * DISSOC_PHI_STEP, { stoich: pr.stoich }), v: new Float64Array(DISSOC_T_NODES * DISSOC_P_NODES).fill(NaN) };
      dissocCache.set(key, grid);
    }
    return grid;
  };
  const at = (grid, a, b) => {
    const k = a * DISSOC_P_NODES + b;
    let v = grid.v[k];
    if (Number.isNaN(v)) {
      v = dissociatedEnergyJPerKg(grid.pr, COEFF.DISSOC_MIN_K + a * DISSOC_T_STEP_K, Math.exp((b + DISSOC_P_NODE0) * DISSOC_LNP_STEP));
      grid.v[k] = v;
    }
    return v;
  };
  const u = ft - i; const w = fp - j; const r = fq - q;
  const bilinear = (grid) => (at(grid, i, j) * (1 - u) + at(grid, i + 1, j) * u) * (1 - w)
    + (at(grid, i, j + 1) * (1 - u) + at(grid, i + 1, j + 1) * u) * w;
  return bilinear(gridOf(q)) * (1 - r) + bilinear(gridOf(q + 1)) * r;
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
