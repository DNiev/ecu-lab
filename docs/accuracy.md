# How accurate is ECU Lab?

ECU Lab is a teaching model. It is meant to get the **direction** of every change right
(what knocks, what leans out, which way a part moves power) and the **size** close. This
page says where it is close, where it is not, and how that is checked.

Two kinds of number appear here. **The model's own figures** — the presets table and the
size of each approximation below — are checked by `tests/accuracy-claims.test.js`: if the
physics moves one, that test fails and names the sentence to update, so this page cannot
quietly go stale. **The real-engine figures** they are compared with come from the
sources cited beside them. No test can measure a car, so those are only as good as their
source, and the weaker sources are marked as such.

## How it is checked

| Test | What it holds the model to |
|---|---|
| `tests/presets.test.js` | Each of the seven factory engines makes its published power (±5%) and torque (±10%), peaks where the maker says (±500 RPM), and does not knock. |
| `tests/benchmark.test.js` | Everything else a dyno sheet or a textbook would show about those pulls — mixture, timing, fuel per horsepower, air per horsepower, exhaust temperature, cylinder pressure, load per litre, friction — sits inside the range real gasoline engines run in, and boost pays roughly what it does on a real engine. |
| `tests/physics-invariants.test.js` | Laws checked on 1,500 random operating points and 120 random builds: energy (no cycle beats the ideal Otto cycle), units (hp = torque × RPM ÷ 5252, airflow, mixture and mean pressures agree), and every lever pulls the right way (octane, boost, intercooling, compression, MBT, retard, mixture, knock, and boost never falling as more is asked for). |
| `tests/consistency-fuzz.test.js` | On 40 random builds, the TUNE advisor, the dyno pull log and LIVE tell the same story, and following the advice clears the knock it reports. |
| `tests/tuning-consistency.test.js` | The same, pinned on hand-picked engines, including LIVE at idle and on the rev limiter. |
| `tests/accuracy-claims.test.js` | Every figure this page and Learn article 39 quote about the model. |

Random builds are seeded (`tests/randomBuilds.js`), so any failure names a seed that
rebuilds the exact engine.

## The factory engines against their ratings

Crank figures; the app shows wheel figures, 15% lower. Every simulated cell is checked
against the model by `tests/accuracy-claims.test.js`; the rated figures are the makers'.

| Engine | Rated | Simulated | Peak power RPM (rated / sim) | λ | Timing | BSFC lb/hp·h | hp per lb/min air | EGT °C | Peak cyl. bar | BMEP bar at peak torque |
|---|---|---|---|---|---|---|---|---|---|---|
| Nissan VQ35DE Rev-Up | 300 hp / 260 lb-ft | 300 hp / 273 lb-ft | 6400 / 6500 | 0.874 | 29.1° | 0.402 | 11.6 | 779 | 65 | 13.3 |
| Nissan VQ35HR | 306 hp / 268 lb-ft | 306 hp / 273 lb-ft | 6800 / 6500 | 0.874 | 29.1° | 0.399 | 11.7 | 774 | 67 | 13.3 |
| BMW N54 | 302 hp / 295 lb-ft | 295 hp / 314 lb-ft | 5800 / 5500 | 0.842 | 22.9° | 0.411 | 11.8 | 791 | 76 | 17.9 |
| BMW B58B30M0 | 320 hp / 330 lb-ft | 329 hp / 353 lb-ft | 5500–6500 / 5500 | 0.835 | 17.5° | 0.416 | 11.8 | 800 | 77 | 20.0 |
| BMW B58B30M1 | 382 hp / 369 lb-ft | 376 hp / 382 lb-ft | 5800 / 5700 | 0.832 | 15.9° | 0.417 | 11.8 | 812 | 81 | 21.7 |
| VW EA888.3 (GTI) | 220 hp / 258 lb-ft | 231 hp / 249 lb-ft | 4700–6200 / 5500 | 0.834 | 18.8° | 0.428 | 11.5 | 820 | 76 | 21.4 |
| VW EA888.3 (Golf R) | 292 hp / 280 lb-ft | 305 hp / 302 lb-ft | 5400–6500 / 6300 | 0.830 | 19.5° | 0.411 | 12.0 | 819 | 89 | 25.9 |

**Reference ranges** (the bands `tests/benchmark.test.js` enforces):

| Quantity | Real engines | Source |
|---|---|---|
| Full-load λ, NA / boosted | 0.84–0.90 / 0.76–0.87 | Heywood, *Internal Combustion Engine Fundamentals* (best-power mixture); the boosted band is wider and richer for charge and turbine cooling — common practice, not separately sourced here |
| BSFC at peak power, NA | 0.45–0.50 typical, 0.41–0.42 for the best modern street engines | EngineLabs, "Dyno Days" (Westech) |
| BSFC at peak power, turbo | 0.50–0.60 | Garrett Motion, Turbo Tech 103 |
| Crank hp per lb/min of air | about 10–11 | Garrett Motion, "How to select a turbo, part 2" |
| 50% burned at MBT | 8–10° after top dead centre | Heywood (the standard MBT phasing criterion) |
| Turbine inlet temperature | held under about 950 °C by enrichment | ASME J. Eng. Gas Turbines Power 132(11) 112801 |
| Peak cylinder pressure, boosted | about 120 bar, 140 for the latest designs | Eng-Tips engineering forum ("Peak Cylinder Pressures") — practitioners, not a primary source |
| BMEP at peak torque, NA / downsized turbo | 11–14 / 17–27 bar | computed from the makers' published torque and displacement (BMEP = 4π × torque ÷ displacement) |
| Friction plus pumping at peak power | 0.8–3.0 bar | Heywood (engine friction); a wide band, deliberately |

**Real stock dyno sheets** (wheel figures from owner and tuner posts, which vary by dyno and day — indicative, not authoritative): 350Z Rev-Up
about 215–235 whp (Dynojet / Dyno Dynamics); N54 135i 252–271 whp; B58 M340i about 366
whp; Mk7 GTI 207–243 whp; Mk7 Golf R 260–276 whp (AWD). The app's flat 15% drivetrain
loss sits between these: the Nissan loses more, and BMW's and VW's turbo engines are
rated low, so they read closer to their rating than a 15% loss predicts.

## Known approximations

Each of these is measured, written down in the code where it arises, and taught in
Learn article 39. None of them changes the direction of any lesson.

1. **Fuel per horsepower runs 10–15% low.** The presets burn 0.40–0.43 lb/hp·h against
   0.45–0.60 for real engines of their kind, and flow about 11.5–12 hp per lb/min of air
   against 10–11. Power is fitted to the published ratings, so the air and fuel needed to
   make it, and the injector duty that follows, read low by the same margin. Generic
   builds are closer (0.46–0.52 on a 9:1 turbo build on pump fuel).
2. **Turbos spool late.** Turbine power comes from steady exhaust flow; the pulse energy a
   twin-scroll housing harvests is not modelled. At 1500–2000 RPM the turbo presets
   make 15–50% less torque than the real engines, and nothing holds their torque flat the
   way a factory torque limit does, so most peak 3–8% above their rated torque mid-range
   (the GTI peaks 3% under it).
3. **Exhaust temperature reads low at full throttle.** The gauge reads about 780 °C (NA)
   and 790–820 °C (boosted). Production turbo engines run up to about 950 °C at the
   turbine inlet before enrichment holds them there (ASME source above); the code's own
   fit target for an NA engine is about 850 °C, a figure it carries without a cited source.
   The exhaust-port cooling that sets it is fitted to the cruise and part-throttle bands,
   and one number cannot hit those and full throttle together. Enrichment cools it about
   10–15 °C from 13.5:1 to 11:1, several times less than the turbine-side correlation
   uses for the same change, so EGT component protection is less effective in the sim.
   And it peaks at stoichiometric, where a real engine's exhaust peaks a little lean of it.
4. **Very rich mixtures cost almost no power.** The rich burn is air-limited, which is
   right, but the slower and cooler flame far rich is not charged, so λ 0.70 makes about
   what λ 0.88 does. On a real engine power falls away richer than best power; by how
   much is not checked here. The pull log still flags running that rich.
5. **Best-torque timing.** The advisors aim for the textbook MBT. The model's own cycle
   makes its best torque a median 2° later than that, within 7.5° for 95% of operating
   points and up to about 15° at the rare extreme (mostly low RPM); following the advice
   costs under 3% of torque at any of them.
6. **Intercooling at extreme backpressure.** With a turbine so small that a fifth of the
   cylinder is trapped exhaust, the hot residual sets the end-gas temperature and an
   intercooler barely lowers it, so the denser charge can knock slightly sooner. With any
   sensible turbine the intercooler buys margin, as it does on a real engine.
7. **Peak cylinder pressure runs low under boost.** The turbo presets peak at 75–90 bar
   (NA presets 60–70) against about 100–120 bar quoted for production turbo engines
   (the weakest source here). The model's mechanical limit, `PEAK_PRESSURE_LIMIT_BAR`
   (105), is set on the model's own scale, so its warnings are consistent with each other.
8. **Compressor heat at one efficiency.** Charge temperature uses a fixed 70% compressor
   efficiency (`COMP_ISEN_EFF`). The compressor map decides how much boost the turbo can
   hold, but running off the middle of it does not heat the charge further, as it would
   on a real turbo; the pull log's compressor event is the only cost. The next model
   improvement worth making.
9. **Wheel horsepower** is crank × 0.85 for every car.
10. **E85 starts as easily cold as gasoline.** Charge cooling assumes the fuel evaporates by
   the spark, bounded only by the fuel vapour's dew point at the top of compression
   (`fuelDewPointK`). That stops a flooded engine from firing, but it does not make
   ethanol's low vapour pressure bite on a cold morning: a real E85 engine is hard to
   start in freezing weather (why winter E85 is blended down to around E70), while here
   it starts at −20 °C like gasoline.

## Open for the maintainers

- **The Engineer Score's NA compression warning is stricter than the physics.** It starts
  at 11.5:1 (`COMPRESSION_NA_BASE`); the stock V6 on 91 octane now loses a degree to knock
  only at about 12.7:1. The comment beside it records both. Either the score moves to the
  physics or the low-speed knock limit is revisited; that is a design call, so it is left
  as it is and flagged here.
- **Some coefficient comments quoted measurements from earlier models.** The audit
  re-measured each one that states a model output and corrected it in place, keeping the
  old figure where it explains a past decision.

## Fixed by this audit

- **Exhaust blowdown** expanded the exhaust to atmospheric pressure instead of the
  exhaust manifold's, so boosted engines read 150–200 °C cooler than the turbine-side
  correlation for the same point, and cooler than NA engines. It now blows down into the
  manifold (`src/sim/cycle.js`).
- **The turbo solve** did not converge. It started at the boost target and relaxed down
  in three passes, which past the surge line cycled between two or three answers, so the
  result depended on how much boost was asked for even when none of it could be made:
  asking for 16 psi at 1900 RPM gave less than asking for 5. It now spools up from zero and
  stops at the first pressure the turbine cannot hold (`src/sim/turbo.js`).
- **The wastegate** relieved backpressure in proportion to the boost shortfall — exactly
  when a real gate is shut — and not when it was actually bleeding surplus. It now opens
  on surplus; its strength was refitted so every turbo preset stays within 5% of its rating.

- **A flooded engine broke the model.** Charge cooling from evaporating fuel had no
  limit, so a grossly over-fuelled charge (λ near 0.15, as a cold start on a VE table far
  too high can deliver on E85) was cooled below absolute zero and LIVE read NaN for RPM.
  Evaporation is now bounded by the fuel vapour's dew point at the top of compression
  (Clausius-Clapeyron through each fuel's Reid vapour pressure). Past it the fuel stays
  liquid: the engine cranks, the wideband reads the flood, and it will not fire. No
  correctly fuelled result moves.

Together these regenerate the behavioural fingerprint. Naturally aspirated results are
unchanged apart from exhaust temperature; boosted results move on average +1.7% (mild
boost) and −0.8% (heavy boost), with the largest moves on turbos far too small for their
engine, which previously made boost the compressor could not pass. The dew-point bound
moves only the fingerprint's grossly over-fuelled cells (850 cc injectors on a 315 cc
calibration, on E85), by at most one unit of power or torque.

## Claims audit

Every sentence a player reads that states a number or a behaviour was checked against the
model, against arithmetic, or against a source: all 39 Learn articles, the tutorial, the
page guides and one-line tips, each setting's full explanation, the prose on every BUILD,
TUNE, DYNO, DRAG, LIVE and HOME screen, the career briefs, every pull-log message, the
README and the presets' published figures (checked against the makers' ratings). Code
comments were checked wherever they quote a model output or a fitted anchor.

Corrected in this pass (each now matches the model, or says where it does not):
knock limit falling ~4-5° per 20 kPa, not "2°" (Learn 13); peak-pressure overstatement
~7%, not "15%" (Learn 24, coefficients); burn duration rising ~25% with speed, not
"roughly constant" (Learn 4); boosted best-power λ 0.83, not "0.78-0.82" (tutorial);
peak cylinder pressure on the datalog screen; MBT defined as the least advance, not the
earliest; several page guides that said "exactly your table" without the exceptions;
screen names that did not exist (TUNE › AIR, BUILD → FUEL, "On ECU", "FUEL" for
injector scaling); the compressor's heat, which the model does not charge; advice to fit
parts the app does not offer; the cylinder-count knock claim; the real-software note
that the app folds corrections together (it no longer does); the README's Node
requirement, fingerprint size and file map; stale figures in preset and coefficient
comments. `tests/accuracy-claims.test.js` now fails if a screen name, a figure on this
page or in Learn article 39 drifts from the model.

What is not claimed: that every code comment in the repository was read sentence by
sentence. Comments that explain code rather than state a measured fact were not
re-verified, and a few real-world figures rest on practitioner sources, marked as such
above.

