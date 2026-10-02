/**
 * NITROUS OXIDE: carrying oxygen into the cylinder instead of pumping it.
 *
 * N₂O is 36.4% oxygen by mass against air's 23.1%, so a kilogram of it brings the oxygen
 * of 1.57 kg of air. Above about 300 °C it comes apart (2 N₂O → 2 N₂ + O₂), and that
 * breakdown itself releases 82 kJ per mole — heat on top of what the extra fuel burns.
 * It arrives as a liquid and flashes to vapour in the intake, cooling the charge as it
 * boils; the vapour then takes up room the air would have had.
 *
 * THE BOTTLE. N₂O is stored as a liquid under its own vapour pressure, so bottle pressure
 * is set by bottle TEMPERATURE, not by how full it is: about 760 psi at 70 °F, 920 at 85 °F,
 * and 1,050 at its critical point, 97.6 °F. The jets are sized for a pressure (900-950 psi),
 * so a cold bottle flows less nitrous than the shot is rated for and a hot one more. Spray
 * and liquid boils to fill the room the spray left, chilling what remains: pressure falls
 * through a pass, and more the emptier the bottle. A heater sets the pressure each pass
 * starts at and restores it between passes; it is too slow to hold it within one.
 *
 * THE JETS. A "100 shot" is a jet sized to add about 100 hp at rated bottle pressure; it
 * flows 5-6 lb of nitrous a minute. Flow through the jet goes as √(ρ·ΔP) — liquid through
 * an orifice. A WET kit meters fuel through its own jet from the fuel system, at a fixed
 * pressure, so its fuel does not follow the bottle: a cold bottle runs the nitrous mixture
 * rich and a hot one lean. A DRY kit sprays nitrous only and relies on the ECU to add the
 * fuel through the injectors.
 */

import { COEFF } from './coefficients.js';
import { clamp } from './math.js';

/** Nitrous oxide's own properties. */
export const N2O = {
  molarG: 44.013,
  /** Specific gas constant, J/(kg·K): 8.314 J/(mol·K) over 44.013 g/mol. */
  gasConstant: 8.314462618 / 0.044013,
  /** Mass fraction of oxygen, and of the nitrogen left behind. */
  o2MassFrac: 32 / (2 * 44.013),
  /** Decomposition enthalpy, 2 N₂O → 2 N₂ + O₂: −82.05 kJ/mol (NIST), per kg. */
  decompJPerKg: 82050 / 0.044013,
  /** Critical point (NIST): 309.52 K, 7.245 MPa, 452 kg/m³. */
  critK: 309.52,
  critDensity: 452,
  /** Normal boiling point and enthalpy of vaporisation there (NIST: 184.67 K, 16.53 kJ/mol). */
  nbpK: 184.67,
  hvapNbpJPerKg: 16530 / 0.044013,
  /** Heat capacity of the vapour near room temperature (NIST: 38.6 J/(mol·K)), per kg. */
  vapourCp: 38.6 / 0.044013,
};

/** Oxygen in air, by mass. */
const AIR_O2_MASS_FRAC = 0.2314;

/** How much air a gram of nitrous is worth in oxygen. */
export const N2O_AIR_EQUIV = N2O.o2MassFrac / AIR_O2_MASS_FRAC;

/**
 * Bottle pressure at a bottle temperature, psi (gauge). Clausius-Clapeyron through the
 * racing charts' 762 psi at 70 °F and 921 psi at 85 °F; it reproduces their ~590 psi at
 * 50 °F, and lands within 2% of the critical point (1,051 psia; 1,070 here). Above the
 * critical temperature there is no liquid left to hold a vapour pressure; the bottle is
 * held at the critical value here.
 *
 * @param {number} bottleK
 * @returns {number}
 */
export function bottlePressurePsi(bottleK) {
  const t = Math.min(bottleK, N2O.critK);
  return COEFF.N2O_REF_PSI * Math.exp(-COEFF.N2O_VAPOUR_B * (1 / t - 1 / COEFF.N2O_REF_K));
}

/**
 * Saturated nitrous oxide from the ESDU 91022 correlations, the ones hybrid-rocket tank
 * models use. `y` is 1 − T/T_c; all three fall to the critical values at 97.6 °F.
 */
const ESDU = {
  liquid: [1.72328, -0.83950, 0.51060, -0.10412],
  vapour: [-1.00900, -6.28792, 7.50332, -7.90463, 0.629427],
  cp: [2499.73, 0.023454, -3.80136, 13.0945, -14.5180],
};
/** Keeps the correlations off the critical point itself, where heat capacity diverges. */
const NEAR_CRITICAL_Y = 0.005;

/**
 * Density of the saturated liquid, kg/m³: 907 at 0 °C, 786 at 20 °C, 452 at the critical
 * point.
 *
 * @param {number} bottleK
 * @returns {number}
 */
export function liquidDensity(bottleK) {
  const y = Math.max(0, 1 - Math.min(bottleK, N2O.critK) / N2O.critK);
  const [b1, b2, b3, b4] = ESDU.liquid;
  return N2O.critDensity * Math.exp(b1 * y ** (1 / 3) + b2 * y ** (2 / 3) + b3 * y + b4 * y ** (4 / 3));
}

/**
 * Density of the saturated vapour above the liquid, kg/m³: about 98 at 0 °C, 160 at 20 °C,
 * rising to meet the liquid at the critical point.
 *
 * @param {number} bottleK
 * @returns {number}
 */
export function vapourDensity(bottleK) {
  const x = Math.max(0, N2O.critK / Math.min(bottleK, N2O.critK) - 1);
  const [b1, b2, b3, b4, b5] = ESDU.vapour;
  return N2O.critDensity * Math.exp(b1 * x ** (1 / 3) + b2 * x ** (2 / 3) + b3 * x + b4 * x ** (4 / 3) + b5 * x ** (5 / 3));
}

/**
 * Heat capacity of the saturated liquid, J/(kg·K): about 2.3 kJ at 0 °C, 3.2 at 20 °C and
 * climbing steeply toward the critical point, so a warm bottle holds its temperature
 * better than a cold one.
 *
 * @param {number} bottleK
 * @returns {number}
 */
export function liquidCp(bottleK) {
  const y = Math.max(NEAR_CRITICAL_Y, 1 - bottleK / N2O.critK);
  const [c0, c1, c2, c3, c4] = ESDU.cp;
  return c0 * (1 + c1 / y + c2 * y + c3 * y * y + c4 * y * y * y);
}

/**
 * Heat it takes to boil the liquid, J/kg, by the Watson relation from the normal boiling
 * point: about 235 kJ/kg at 0 °C, 175 at 20 °C, 120 at 30 °C and none at the critical point.
 * It is what the flashing nitrous takes from the charge, so a hot bottle cools it less.
 *
 * @param {number} bottleK
 * @returns {number}
 */
export function latentHeatJPerKg(bottleK) {
  const tr = Math.min(bottleK, N2O.critK) / N2O.critK;
  const trNbp = N2O.nbpK / N2O.critK;
  return N2O.hvapNbpJPerKg * Math.pow(Math.max(0, 1 - tr) / (1 - trNbp), 0.38);
}

/**
 * Nitrous flow through a jet, kg/s.
 *
 * @param {object} input
 * @param {number} input.shotHp what the jet is rated to add
 * @param {number} input.bottlePsi bottle pressure, gauge
 * @param {number} input.bottleK
 * @param {number} input.manifoldPsi manifold pressure the jet sprays into, gauge
 * @returns {number}
 */
export function nitrousFlowKgS({ shotHp, bottlePsi, bottleK, manifoldPsi }) {
  const refKgS = shotHp * COEFF.N2O_LB_MIN_PER_HP * 0.45359237 / 60;
  const dp = Math.max(0, bottlePsi - manifoldPsi);
  const refDensity = liquidDensity(COEFF.N2O_REF_BOTTLE_K);
  return refKgS * Math.sqrt(dp / COEFF.N2O_REF_BOTTLE_PSI) * Math.sqrt(liquidDensity(bottleK) / refDensity);
}

/**
 * Fuel a wet kit's fuel jet delivers, kg/s: sized so the nitrous it is paired with burns
 * at the kit's jetted mixture at rated bottle pressure, and fixed from there by the fuel
 * pressure behind it — it does not follow the bottle.
 *
 * @param {number} shotHp
 * @param {{stoich: number}} fuel
 * @returns {number}
 */
export function wetKitFuelKgS(shotHp, fuel) {
  const refKgS = shotHp * COEFF.N2O_LB_MIN_PER_HP * 0.45359237 / 60;
  return (refKgS * N2O_AIR_EQUIV) / (fuel.stoich * COEFF.N2O_WET_LAMBDA);
}

/**
 * The bottle through a pass, and between passes.
 *
 * A racing bottle feeds liquid up a siphon tube. As liquid leaves, the vapour above it
 * has more room, and liquid boils to fill it at the vapour's density: that boiling, not
 * the nitrous that left, is what cools the bottle. The heat comes out of the liquid first
 * — the wall passes heat in only slowly — so the pressure sags through a pass and more as
 * the bottle empties and there is less liquid to share the cooling. Between passes the
 * wall warms the liquid back; a heater warms the wall, and the wall trades heat with the
 * air around it.
 *
 * @param {{massKg: number, tempK: number, wallK?: number}} bottle
 * @param {number} usedKg nitrous drawn this step
 * @param {number} dt seconds
 * @param {{heater: boolean, setK: number, ambientK: number}} opts
 * @returns {{massKg: number, tempK: number, wallK: number}}
 */
export function stepBottle(bottle, usedKg, dt, { heater, setK, ambientK }) {
  const massKg = Math.max(0, bottle.massKg - usedKg);
  let tempK = bottle.tempK;
  let wallK = bottle.wallK ?? bottle.tempK;
  const liquidHeat = Math.max(0.05, massKg) * liquidCp(tempK);
  const rhoL = liquidDensity(tempK);
  const rhoV = vapourDensity(tempK);
  const boiledKg = usedKg * rhoV / Math.max(1, rhoL - rhoV);
  const wallToLiquidW = COEFF.N2O_WALL_LIQUID_UA * (wallK - tempK);
  tempK += (wallToLiquidW * dt - boiledKg * latentHeatJPerKg(tempK)) / liquidHeat;
  const heaterW = heater && wallK < setK ? COEFF.N2O_HEATER_W : 0;
  wallK += ((heaterW + COEFF.N2O_BOTTLE_AMBIENT_UA * (ambientK - wallK) - wallToLiquidW) * dt) / COEFF.N2O_BOTTLE_WALL_J_PER_K;
  return { massKg, tempK: clamp(tempK, N2O.nbpK, N2O.critK), wallK };
}

/**
 * Temperature of the charge once the nitrous has flashed into it, K.
 *
 * The liquid leaves the bottle at bottle temperature and boils, taking its latent heat
 * from what surrounds it; the vapour it becomes is then part of the charge and settles
 * at the same temperature as the air. Energy in balances energy out:
 *
 *     (m_air·c_air + m_n2o·c_vap) · T = m_air·c_air·T_air + m_n2o·c_vap·T_bottle − m_n2o·L·share
 *
 * `share` is how much of that latent heat the air pays; the rest comes out of the
 * plumbing and manifold walls, which is why the lines frost. The vapour's own heat
 * capacity is what keeps a big shot on little air from chilling the charge to nonsense:
 * it has to be cooled too. Nothing boils below nitrous's boiling point, so that bounds it.
 *
 * @param {object} input
 * @param {number} input.airG air in the cylinder, grams
 * @param {number} input.airK its temperature before the nitrous
 * @param {number} input.airCp its heat capacity, J/(kg·K)
 * @param {number} input.n2oG nitrous, grams
 * @param {number} input.bottleK
 * @param {number} input.share share of the latent heat the charge pays
 * @returns {number}
 */
export function chargeWithNitrousK({ airG, airK, airCp, n2oG, bottleK, share }) {
  const airHeat = airG * airCp;
  const vapHeat = n2oG * N2O.vapourCp;
  const t = (airHeat * airK + vapHeat * bottleK - n2oG * latentHeatJPerKg(bottleK) * share) / (airHeat + vapHeat);
  return Math.max(N2O.nbpK, t);
}

/**
 * The nitrous and wet-kit fuel reaching one cylinder event.
 *
 * @param {object} input
 * @param {number} input.n2oKgS nitrous flow
 * @param {number} input.fuelKgS wet-kit fuel flow (0 for a dry kit)
 * @param {number} input.rpm
 * @param {number} input.cyl
 * @returns {{n2oG: number, fuelG: number}}
 */
export function perCylinderEvent({ n2oKgS, fuelKgS, rpm, cyl }) {
  const eventsPerS = cyl * (rpm / 2) / 60;
  return { n2oG: (n2oKgS * 1000) / eventsPerS, fuelG: (fuelKgS * 1000) / eventsPerS };
}
