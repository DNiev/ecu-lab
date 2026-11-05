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
| `tests/presets.test.js` | Each of the thirteen factory engines makes its published power (±5%) and torque (±10%), peaks where the maker says (±500 RPM), and does not knock. |
| `tests/benchmark.test.js` | Everything else a dyno sheet or a textbook would show about those pulls — mixture, timing, fuel per horsepower, air per horsepower, exhaust temperature, cylinder pressure, load per litre, friction — sits inside the range real gasoline engines run in, and boost pays roughly what it does on a real engine. |
| `tests/physics-invariants.test.js` | Laws checked on 1,500 random operating points and 120 random builds: energy (no cycle beats the ideal Otto cycle), units (hp = torque × RPM ÷ 5252, airflow, mixture and mean pressures agree), and every lever pulls the right way (octane, boost, intercooling, compression, MBT, retard, mixture, knock, and boost never falling as more is asked for). |
| `tests/consistency-fuzz.test.js` | On 40 random builds, the TUNE advisor, the dyno pull log and LIVE tell the same story, and following the advice clears the knock it reports. |
| `tests/tuning-consistency.test.js` | The same, pinned on hand-picked engines, including LIVE at idle and on the rev limiter. |
| `tests/ve-learn.test.js` | The VE table is corrected only from what a tuner could log: the wideband against the table's target, the fuel trims, and the MAF's own error kept out (a cold air intake on the stock tune logs its real 0–5% VE gain, not the MAF housing's 10%). Only logged cells move; half-steps converge; nitrous, maxed injectors, protection, cut, warm-up and transients are left out; a log already applied cannot be applied twice. |
| `tests/ui/tutorial.test.jsx` | The tutorial stays within five minutes, and the tutorial and the Tuning Course quote the game's own numbers: its stock pull is the pull the app makes, every lesson scenario does what its lesson says (over-advanced spark knocks and gains nothing; the intake logs MAF and lean entries; the retune clears both), and every numbered callout still points at something on its live screen. |
| `tests/accuracy-claims.test.js` | Every figure this page and Learn article 39 quote about the model. |
| `tests/blower.test.js` | Superchargers: boost from low down on a Roots or twin-screw and climbing with RPM on a centrifugal; the pulley sets boost; a positive-displacement blower's efficiency falls past its design ratio no faster than isochoric compression, so its boost always settles where the engine swallows it; the crank pays the compression work; efficiency ranks and heats the charge as the makers publish; no lag on LIVE; ~7 psi intercooled adds 35–50%; an over-spun blower is flagged with a pulley that fixes it. |
| `tests/nitrous.test.js` | Nitrous: its oxygen and breakdown heat; bottle pressure against the racing charts; a 100 shot's 5–6 lb/min; gain in step with the shot; the knock limit falling a few degrees per 50 hp (3–4° on pump 93, where tuners start from 2°); a wet kit rich on a cold bottle; a speed-density ECU fuelling for the air the vapour displaced, the pull log's fuel correction clearing it in one step, closed loop standing down while spraying, and a weak pump starving the kit; the controller's window, ramp and lean cut, on the dyno and LIVE. |

Random builds are seeded (`tests/randomBuilds.js`), so any failure names a seed that
rebuilds the exact engine.

## The factory engines against their ratings

Crank figures; the app shows wheel figures, 15% lower. Every simulated cell is checked
against the model by `tests/accuracy-claims.test.js`; the rated figures are the makers'.

| Engine | Rated | Simulated | Peak power RPM (rated / sim) | λ | Timing | BSFC lb/hp·h | hp per lb/min air | EGT °C | Peak cyl. bar | BMEP bar at peak torque |
|---|---|---|---|---|---|---|---|---|---|---|
| Nissan VQ35DE Rev-Up | 300 hp / 260 lb-ft | 273 hp / 246 lb-ft | 6400 / 6600 | 0.874 | 29.3° | 0.453 | 10.3 | 753 | 60 | 11.9 |
| Nissan VQ35HR | 306 hp / 268 lb-ft | 291 hp / 253 lb-ft | 6800 / 7000 | 0.874 | 29.7° | 0.451 | 10.4 | 749 | 65 | 12.3 |
| BMW N54 | 302 hp / 295 lb-ft | 288 hp / 308 lb-ft | 5800 / 5500 | 0.841 | 17.8° | 0.466 | 10.4 | 757 | 73 | 17.6 |
| BMW B58B30M0 | 320 hp / 330 lb-ft | 306 hp / 332 lb-ft | 5500–6500 / 5500 | 0.832 | 14.4° | 0.475 | 10.3 | 761 | 75 | 18.8 |
| BMW B58B30M1 | 382 hp / 369 lb-ft | 355 hp / 368 lb-ft | 5800 / 5600 | 0.830 | 11.3° | 0.480 | 10.3 | 777 | 79 | 20.9 |
| VW EA888.3 (GTI) | 220 hp / 258 lb-ft | 212 hp / 232 lb-ft | 4700–6200 / 5500 | 0.830 | 14.7° | 0.495 | 9.9 | 783 | 73 | 19.9 |
| VW EA888.3 (Golf R) | 292 hp / 280 lb-ft | 282 hp / 279 lb-ft | 5400–6500 / 6200 | 0.830 | 14.6° | 0.473 | 10.4 | 777 | 85 | 23.9 |
| GM LS1 (C5 Corvette) | 350 hp / 375 lb-ft | 346 hp / 366 lb-ft | 5600 / 5500 | 0.874 | 29.4° | 0.488 | 9.6 | 757 | 59 | 11.0 |
| GM LS6 (Cadillac CTS-V) | 400 hp / 395 lb-ft | 380 hp / 373 lb-ft | 6000 / 5900 | 0.874 | 29.9° | 0.486 | 9.6 | 752 | 62 | 11.2 |
| GM LQ4 Vortec 6000 | 325 hp / 370 lb-ft | 322 hp / 371 lb-ft | 5200 / 5000 | 0.874 | 29.9° | 0.495 | 9.4 | 767 | 55 | 10.6 |
| GM LM7 Vortec 5300 | 295 hp / 335 lb-ft | 293 hp / 334 lb-ft | 5200 / 5000 | 0.874 | 28.2° | 0.490 | 9.5 | 760 | 57 | 10.7 |
| GM LR4 Vortec 4800 | 285 hp / 295 lb-ft | 278 hp / 300 lb-ft | 5200 / 5500 | 0.874 | 28.8° | 0.502 | 9.3 | 765 | 55 | 10.6 |
| Chrysler 6.4 HEMI (392) | 475 hp / 470 lb-ft | 472 hp / 460 lb-ft | 6000 / 6000 | 0.874 | 22.1° | 0.438 | 10.7 | 755 | 67 | 12.2 |

Each engine's one fitted input is its cam duration, set where peak power lands on the
rating; torque and the peak speeds are predictions. The cams were refitted after the
rich-flame chemistry below, which took about 4% of the heat out of every full-throttle
point: the pushrod V8s, the HEMI and the Golf R now land within 0–4% of their ratings again.
Five cannot be refitted onto theirs and are recorded as known gaps in
`tests/presets.test.js`: the VQ35DE Rev-Up (−9%; a longer cam runs its power flat into the
7000 limiter, which the real engine does not do), the VQ35HR (−5%; the cam that lands it
inside the band makes its stock spark knock once an intake and headers are fitted), the LS6
(−5%; its cam is held at 228 by the overlap advisory, and its real heads out-flow the LS1's on
the same valve size, which a breathing model built on valve diameter cannot see), the
B58B30M1 (−8%) and the GTI's torque
(−10%), both held far from MBT by the knock limit at full boost, where cam duration does
not move peak output. The twin-plug HEMI runs about 22° of spark at peak power where
one-plug engines run 28–30°: two flames burn the charge faster (engine.js), so best torque
needs less advance.

## Rich flames, and why enrichment cools the exhaust

Until October 2026 a rich mixture was charged only for the mass of its surplus fuel: the
fuel up to stoichiometric burned completely and the rest did nothing. That is not what a
flame does. Past stoichiometric there is not enough oxygen to take every carbon to CO₂ and
every hydrogen to water, and the oxygen there is does not go only to the products that pay
best: taking a carbon as far as CO releases 283 kJ per mole of O₂ where CO₂ releases 787.
The model now works out the products from the element balance and the water-gas shift
(CO + H₂O ⇌ CO₂ + H₂, equilibrium constant 3.5 as Heywood, *Internal Combustion Engine
Fundamentals*, §4.9, uses for exhaust composition), and charges the heat left in the CO and
H₂ (`combustionProducts`, `richHeatReleased` in thermo.js). For gasoline at 11:1 the flame
releases about two thirds of the fuel's energy, against three quarters under the old cap.
Its CO prediction, about 3% at 13.5:1 and 6–7% at 12:1, is what SI exhaust measures.

A real charge is also not one mixture: fuel films, vaporisation and cylinder-to-cylinder
spread leave pockets richer and leaner than the mean, which is why a stoichiometric engine's
exhaust holds about half a percent each of CO and O₂ at once. The model averages over a
normal spread in equivalence ratio of 0.06 (`MIXTURE_PHI_SPREAD`), the width that reproduces
0.5% O₂ and 0.7% CO at a stoichiometric mean (`heatReleasedShare`). And the burned gas's
ratio of specific heats now follows its composition (JANAF heat capacities,
`burnedGammaShift`): diatomic CO and H₂ rich, or surplus O₂ lean, expand a little more
efficiently than stoichiometric CO₂ and water.

What it changed, measured:

| | Before | After | Real engines |
|---|---|---|---|
| EGT, 13.5:1 → 11:1 at full load (NA / turbo) | −9 to −13 °C | −57 / −69 °C | the turbine-side correlation the model already carried: −71 °C |
| A 6.4 L-class V8 at 11:1 compression on boost, 12.5 → 11:1 | flat, within a few °C | −37 °C | cooler |
| BSFC at peak power, presets | 0.42–0.48 | 0.44–0.50 | 0.45–0.50 NA, 0.50–0.60 turbo |
| Crank hp per lb/min of air | 9.8–11.2 | 9.3–10.7 | about 10–11 |
| Power from λ 0.88 to 0.70 | about the same | −11% | falls away |
| Mixture for best power (MBT, fixed air) | flat from 14:1 to 11:1 | λ ≈ 0.94 (stoichiometric 2% under) | λ 0.86–0.91 (stoichiometric 3–5% under) |
| Exhaust temperature peak | exactly stoichiometric | λ ≈ 0.95–0.97 | near stoichiometric, slightly lean |
| A 100-shot wet nitrous kit | 1.0–1.35 × its rating | 0.89–0.98 × | about its rating |

Two of those still disagree with real engines and are listed below: best power sits a little
leaner than a real engine's (dissociation is now computed, but only for CO₂, water and
hydroxyl, which is the lower bound of it), and the exhaust still peaks a little rich of
stoichiometric rather than a little lean of it.

## Engines past 7500 RPM

The breathing curve is read at a speed scaled to where the engine's own cam puts its peak,
and carried past the last factory engine's speed on its own slope (airflow.js); valve
springs on a custom engine are sized for its redline; and the pistons and rods are rated by
mean piston speed (bottomEnd.js), from Wikipedia's "Mean piston speed" and its sources:
production assemblies 21 m/s (medium-speed car engines run about 16, this app's factory
engines 18–20.5 at their limiters), forged 25 (the high-speed band, NASCAR and Formula One),
race 27 (the Audi R8 V10's 26.9 is the production record). A catalogue engine's assembly is
rated to its own factory limiter. BUILD and the pull log say when the redline puts the
pistons and rods past their band; the failure itself is not modelled.

Five high-revving production engines built from their published bore, stroke, compression
and redline through the custom-engine path, each with one cam duration fitted to its power
(published figures from the makers' specifications):

| Engine | Bore × stroke, CR, redline | Fitted cam | Power vs rating (peak RPM, sim / rated) | Torque vs rating (peak RPM, sim / rated) |
|---|---|---|---|---|
| Honda F20C (S2000) | 87 × 84, 11.0:1, 9000 | 282° | −0.5% (8500 / 8300) | +6.9% (6800 / 7500) |
| BMW S54 (E46 M3) | 87 × 91, 11.5:1, 8000 | 266° | +0.3% (7700 / 7900) | −3.5% (5700 / 4900) |
| BMW S65 (E92 M3) | 92 × 75.2, 12.0:1, 8400 | 244° | 0.0% (7500 / 8300) | +7.3% (5800 / 3900) |
| Ford Voodoo (GT350) | 94 × 93, 12.0:1, 8250 | 262° | 0.0% (7600 / 7500) | −6.8% (6200 / 4750) |
| Ferrari F136 FB (458) | 94 × 81, 12.5:1, 9000 | 300° (range maximum) | −3.5% (8200 / 9000) | −3.9% (6800 / 6000) |

Power lands on the rating for four of the five with one fitted input, and the speeds of peak
power land within 200 RPM on three. The two engines with the highest specific output peak
800 RPM early: the single-duration cam cannot reproduce the variable-valve-timing, intake
tuning and valve-lift profiles that let an S65 and a 458 breathe at 8000-9000 RPM, and the
F136 reaches the top of the cam range still 3.5% short. Torque is a prediction and lands
within 7%; where the real engine's torque peak comes early (S65, Voodoo), the model's comes
later, because one cam duration trades low-speed filling for top-end flow where variable
cam timing does not have to. These engines run their bottom-end and overlap advisories in
this build, as a forged assembly at 9000 RPM on a 84 mm stroke (25.2 m/s) is past the
forged band; on the real F20C the factory parts are rated to it.

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
| BMEP at peak torque, NA / downsized turbo | 10.4–14 / 17–27 bar | computed from the makers' published torque and displacement (BMEP = 4π × torque ÷ displacement) |
| Friction plus pumping at peak power | 0.8–3.0 bar | Heywood (engine friction); a wide band, deliberately |

**Real stock dyno sheets** (wheel figures from owner and tuner posts, which vary by dyno and day — indicative, not authoritative): 350Z Rev-Up
about 215–235 whp (Dynojet / Dyno Dynamics); N54 135i 252–271 whp; B58 M340i about 366
whp; Mk7 GTI 207–243 whp; Mk7 Golf R 260–276 whp (AWD). The app's flat 15% drivetrain
loss sits between these: the Nissan loses more, and BMW's and VW's turbo engines are
rated low, so they read closer to their rating than a 15% loss predicts.

## Known approximations

Each of these is measured, written down in the code where it arises, and taught in
Learn article 39. None of them changes the direction of any lesson.

1. **Air per horsepower is close; fuel per horsepower now in the real band.** The presets
   burn 0.44–0.50 lb/hp·h at peak power and make 9.3–10.7 crank hp per lb/min of air,
   against 0.45–0.60 and about 10–11 for real engines of their kind (the GM pushrod V8s
   9.3–9.6, the overhead-cam engines and the HEMI 9.9–10.7). Learn article 39 used to say the
   model got 10–15% more power from each pound of air than a real engine; most of that was
   the rich flame credited with heat its CO and H₂ never release (see "Rich flames" above),
   and it went with it. Friction before October 2026 was the rest (src/sim/friction.js).
   Generic builds: 0.56–0.71 on a 9:1 turbo build on pump fuel, the upper end without an
   intercooler.
2. **Turbos still come in a little late.** At 1500–2000 RPM the turbo presets make 5–26%
   less torque than the makers' published plateaus (the B58 M0 5% at 2000, the N54 11%, the
   EA888s 21–26%); before October 2026 it was 16–54%. Two fixes closed most of it, each
   from measured data:
   - **Low-speed breathing.** The reference breathing curve kept 0.57 of its peak VE at a
     sixth of its peak speed and 0.68 at a third; seven stock GM Gen III calibrations
     (LS1, LS6, LQ4, LM7, LR4) keep 0.76 and 0.81, and the model read 10–20 VE points low
     below 2000 RPM on every one. The curve's low end is now GM's (tables.js, DEFAULT_VE),
     and those engines' full-load VE below 2000 RPM is within −4 to +2 points of GM's on
     the truck engines. A long cam still gives its bottom end away: the charge a late
     intake valve lets the piston push back out at low speed is now computed from the
     slider-crank volume at its closing angle (airflow.js), where the steep old curve had
     stood in for it.
   - **Blowdown pulse energy at the turbine.** The turbine only saw the steady expansion
     from the mean manifold pressure, which at low flow is barely above one. The pulse
     each cylinder releases at exhaust valve opening, at 3.5–6 x manifold pressure in the
     cycle, is now credited at a recovery of 0.35 (turbo.js; Watson & Janota put practical
     pulse systems at a third to a half). It is the one fitted number, set on the N54;
     the B58s and EA888s were not fitted to.
   What is left is spark: under full boost below 2000 RPM the model's knock limit holds
   the B58 near TDC. Against GM's own spark tables the knock model is within about 3°
   below 2000 RPM, so it was not loosened without data that says it should be (a datalog
   of a stock B58 or EA888 with spark and knock retard would settle it). Nothing holds the
   torque flat the way a factory torque limit does. Peak torque lands within 0–5% of the
   rating on four of the five turbo presets; the GTI peaks about 10% under it.
3. **Exhaust temperature reads low at full throttle.** The gauge reads about 750–770 °C (NA)
   and 755–785 °C (boosted) at peak power. Production turbo engines run up to about 950 °C
   at the turbine inlet before enrichment holds them there (ASME source above). The
   exhaust-port cooling that sets it is fitted to the cruise and part-throttle bands, and
   one number cannot hit those and full throttle together; the rich-flame chemistry took
   another 30 °C or so off the full-throttle figure, because the presets run rich there.
   Enrichment now cools it as a real engine's does: 57 °C (NA) and 69 °C (turbo) from 13.5:1
   to 11:1, against 71 °C from the turbine-side correlation. It peaks near λ 0.95–0.97, a
   little rich of stoichiometric, where a real engine's exhaust peaks at or a little lean of
   it. At part throttle most of the charge is pushed out slowly past cooler walls and the
   enrichment effect is smaller; the physics-invariant test asserts the cooling from 85 kPa
   up.
4. **Best power sits a little lean.** With fixed air and spark at MBT, the model makes its
   most power near λ 0.94, about 1% more than at λ 0.88, 7% more than at λ 0.75, and 2% more
   than at stoichiometric. A real engine makes its best power at λ 0.86–0.91, and loses 3–5% at
   stoichiometric: its flame is hot enough to dissociate CO₂ and water, which holds back
   energy until the gas recombines late in expansion, and that costs a stoichiometric mixture
   more than a rich one, whose surplus CO and H₂ hold the equilibria back. Since October 2026
   the cycle computes that (thermo.js, `dissociatedEnergyJPerKg`: the CO₂, water and hydroxyl
   equilibria from the JANAF constants, solved at the burned gas's temperature and pressure
   at every crank step), which moved best power from λ 0.95 and doubled the stoichiometric
   loss from 1% to 2%. Atomic H and O and NO are not carried, so what is left of the gap is
   the lower-bound side of that equilibrium; the rich side's chemistry itself checks against
   measured exhaust (CO 3.7% at λ 0.9 and 7.6% at λ 0.8, against about 3% and 6–7%,
   Heywood §4.9). The factory tables still command the published full-load λ.
5. **Best-torque timing.** The advisors aim for the textbook MBT. The model's own cycle
   makes its best torque a median 3° later than that, within 11° for 95% of operating
   points and up to about 15° at the rare extreme (mostly low RPM); following the advice
   costs under 3% of torque at any of them.
6. **Intercooling at extreme backpressure.** With a turbine so small that a fifth of the
   cylinder is trapped exhaust, the hot residual sets the end-gas temperature and an
   intercooler barely lowers it, so the denser charge can knock slightly sooner. With any
   sensible turbine the intercooler buys margin, as it does on a real engine.
7. **Peak cylinder pressure runs low under boost.** The turbo presets peak at 72–86 bar
   (NA presets about 54–67) against about 100–120 bar quoted for production turbo engines
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
11. **Superchargers make a little more per psi than real kits.** About 7 psi on an
   intercooled engine adds about 48% at the crank here; published kits of that boost add
   35–50% (ProCharger quotes an LS3 from 430 to ~600 hp at 7 psi and a Coyote from 435 to
   ~627 hp at 8 psi, +40–44%). The stock exhaust's backpressure rises in proportion to
   flow here (`EXHAUST_SYSTEM_KPA_PER_KGS`), where a real one rises faster, so a
   supercharged engine exhales a little too easily. Changing it would move every engine
   in the model, so it is recorded instead.
12. **Nitrous adds about its rating.** A 50, 100 and 150 shot add 0.89–0.98 times their
   rating at the crank. It read 1.0–1.35 while a rich flame was credited with all the heat its
   oxygen could release; a wet kit sprays at λ 0.75–0.80, and the smallest shot, sprayed
   richest, lands lowest.
13. **Nitrous through a jet is priced as a liquid.** Flow goes as √(ρ·ΔP) from the bottle
   to the manifold. Real nitrous starts to boil in the jet (two-phase, often choked), which
   the kit makers' jetting charts absorb; the bottle-pressure effect here is the
   single-phase one.
14. **Extra oxygen speeds only the flame's start, and by an estimate.** Zhang et al.
   measured spark-to-10%-burned 3-4° shorter with the oxidant at 25% O₂ instead of 21%,
   the 10-90% burn barely moving ([ACS Omega 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9685745/)).
   Nitrous's oxygen now shortens the model's flame development by the same share
   (`FLAME_DEV_SHARE_PER_O2_PT`), but the paper does not print its baseline, so the share
   rests on an assumed ~25° light-load baseline; a 100 shot moves full-load flame
   development under half a degree. The knock limit falls 3–4° per 50 hp of shot on pump
   93 (a 50 shot about 4°), a little more than the 2° tuners start from, and the exhaust
   port reads about 890–940 °C while a 100 shot sprays on the stock VQ35DE. One owner's log shows EGT
   falling on a 100 shot (Lightning Rodder forum, a practitioner source); no controlled
   measurement of EGT under nitrous was found to test that against, so it is recorded.
15. **The bottle is two lumps, liquid and wall.** The liquid's density and heat capacity
   follow the published saturation curves, and only what boils to refill the room the
   spray left cools it. But the heat paths are estimates — about 100 W/K from wall to
   liquid, 3 W/K from wall to still air, a 250 W heater — and the liquid is one
   temperature. A real bottle cools at the liquid's surface first, where the boiling is,
   so its pressure can sag faster in the first seconds than it does here.

Sources for the supercharger and nitrous figures: Eaton (TVS R1900: 1.9 L/rev, 18,000 rpm,
pressure ratio ~1.8, up to 75% efficient), Whipple (W175AX 2.9 L: 18,000 rpm, peak
adiabatic efficiency 78%, volumetric 99%, built-in ratio 1.36), ProCharger (P-1SC-1:
4.10:1 step-up, 65,000 rpm, 32 psi, 1,200 cfm); efficiency ranges for Roots (~50%),
twin-screw (70–80%) and centrifugal (60–80%) blowers from supercharger comparisons;
nitrous oxide's 36% oxygen, −82 kJ/mol decomposition, 16.53 kJ/mol heat of vaporisation and
38.6 J/(mol·K) vapour heat capacity (NIST); its saturated liquid and vapour densities and
liquid heat capacity from the ESDU 91022 correlations used in hybrid-rocket tank models; the racing bottle pressure chart (762 psi at 70 °F, 921 at 85 °F) and 900–950 psi
recommendations; 4.8–6 lb/min for a 100 shot, and 2° per 50 hp of retard (tuning forums
and kit makers — practitioner rules, the weakest sources here).

## Part-load airflow and table layouts

**Part-load VE** comes from the ideal gas-exchange process (`partLoadVeFactor`,
src/sim/airflow.js): the residual in the clearance volume expands from exhaust to manifold
pressure before fresh charge enters, so VE / VE(full load) = (rc − (Pe/Pi)^(1/γ)) / (rc − 1).
Nothing in it is fitted. On GM's own LM7 VE tables (2400 rpm, intake-air basis) it gives
0.71/0.82/0.88/0.92/0.96 of full load at 20/30/40/50/70 kPa against GM's 0.73/0.81/0.86/0.90/0.95;
the hand-shaped rows it replaced gave 0.54/0.62/0.70/0.77/0.90.

**Overlap backflow at low speed** (October 2026). The law counts only the residual left in
the clearance volume; with both valves open and the intake below the exhaust, burned gas
also flows back into the intake port, and the slower the engine turns the longer it has to.
Once the breathing curve's low end was corrected to GM's (below), the model read 8–10% high
at 800 RPM and 30–50 kPa against the stock LM7, LQ4 and LR4 tables, 4–6% at 1200 and
2–4% at 1600–2000, and agreed from 2400 up and at full throttle. That loss is now carried
(airflow.js; `OVERLAP_BACKFLOW_LOSS`, fitted to those tables, scaled by the cam's own
overlap so a long cam idles on less vacuum): at 30 kPa the truck engines and the LS6 sit
within ±4 VE points of GM's from 800 to 2400 RPM. The LS1 reads 5–9 high there, on a cam
Pro's benchmark fits longer than its preset's. The default engine idles near 800 RPM on
about 27 kPa, as a real V6 does.

**Low-speed breathing at full load** (October 2026). Against the full-load VE rows of seven
distinct stock GM Gen III calibrations, a real engine keeps 0.76 of its peak VE at a sixth of
its peak speed, 0.81 at a third and 0.83 at a little over half; the reference curve had
0.57, 0.68 and 0.81 and read 10–20 VE points low below 2000 RPM on every engine. Its low end
is now GM's (tables.js, `DEFAULT_VE`): the truck engines' full-load VE below 2000 RPM is
within −4 to +2 points of GM's. The bottom end a long cam gives away is computed from the
slider-crank volume at its own intake valve close (no fitted number), where the old steep
curve had stood in for it.

**Table layouts** (src/sim/layouts.js). TUNE can put the VE, spark and mixture tables on
the breakpoints an engine's own computer uses, where those were read from real
calibrations: GM P01/P59 (VE 19 × 20 on MAP; spark 29 × 25 on grams of air per cylinder,
44 stock images) for the five GM V8s, and Chrysler GPEC2 (spark 17 × 17 on milligrams of
air per cylinder, from one stock image) for the 6.4 Hemi. Spark on an airmass axis is read
at the air the ECU's own VE table works out, as those computers read it. The values stay
in ECU Lab's units (VE %, degrees, AFR); GM's VE table itself is grams·K/kPa on GM's
charge temperature. The VQ35, N54, B58 and EA888 computers keep their breakpoints in
the car's flash: their definitions give each table's size but not its axis values, so no
layout is offered for them. Cell-by-cell advice is worked out on the ECU Lab grid and says
so; the tutorials, missions and the career always run on it.

## Open for the maintainers

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
  on surplus; its strength was refitted so every turbo preset stayed within 5% of its rating
  (the B58B30M1 has since fallen 7% under, see the table above).

- **A flooded engine broke the model.** Charge cooling from evaporating fuel had no
  limit, so a grossly over-fuelled charge (λ near 0.15, as a cold start on a VE table far
  too high can deliver on E85) was cooled below absolute zero and LIVE read NaN for RPM.
  Evaporation is now bounded by the fuel vapour's dew point at the top of compression
  (Clausius-Clapeyron through each fuel's Reid vapour pressure). Past it the fuel stays
  liquid: the engine cranks, the wideband reads the flood, and it will not fire. No
  correctly fuelled result moves.

- **Knock the ECU only imagined wore the pistons.** A big cam's valvetrain noise can
  read as knock to the sensor, and the ECU pulls timing for it (`falseknock` in the pull
  log). That retard was also being charged as detonation damage, so a cammed engine with
  no real knock lost pistons on every pull. Only knock beyond the false part now wears
  them (`src/sim/sweep.js`). In the fingerprint this moves `wear.piston` alone, by at
  most 0.003 points, in the 18 cases where real knock sat at the noise level.

- **Bolt-ons were worth about twice what they are.** An intake, cat-back and long-tube
  headers together added 26% on the 3.5 V6 (headers alone 12%, cat-back 7%); a turbo kit
  barely out-made them. Chassis dynos put these parts at about 5-8 whp for an intake,
  5-8 whp for a cat-back, 15-20 whp for long tubes and 30-35 whp together on a VQ35. The
  VE they add (`MOD_BONUS`, `src/sim/hardware.js`) was refitted to that: intake +6,
  cat-back +8, headers +19, all three +37 whp (+14%), each with the MAF and VE retuned.
- **The default engine's factory spark was past MBT.** Its full-load rows ran 2-6° past
  the engine's own best-torque timing from 3500 RPM up (33° at 6500 where MBT is 28°).
  No factory calibration does that: it buys nothing and moves toward knock. With the
  knock model corrected (below) they now sit about 2° under the knock limit where knock
  binds, below about 6000 RPM on 91, and a degree short of MBT above it
  (`DEFAULT_TIMING`, `src/sim/tables.js`). The spark model
  itself was checked against the textbook curve and left alone: 5° from MBT costs about
  1.5%, 10° about 6%, 15° about 10% and 20° about 16%.
- **Factory turbo cars ran 9% lean of their own fuel table.** The presets wrote the turbo
  plumbing's MAF error into the fuel table (commanding ~11.0:1 so ~12.0:1 arrived) and
  left the MAF scalar at 1. The delivered mixture was right, but the datalog showed
  commanded and actual 9% apart on every factory turbo car, and fitting an intake to one
  showed a 17% MAF error where the intake itself is 10%. A factory calibration now cancels
  its own plumbing in the MAF calibration (`factoryCalibration`, `src/sim/presets.js`) and
  commands the mixture it wants.
- **A turbo that could not make its boost said nothing.** Asking a small turbo for 12 psi
  made 5 with no log entry, so more boost on the same hardware looked like it made less
  power. The pull log now reports underboost above 4000 RPM (below it, a shortfall is
  spool) and points at a bigger compressor or turbine (`src/sim/sweep.js`).
- **The MAF entry named a multiplier as if it were a setting.** "About 1.11 cancels this"
  was right only on a car whose scalar was 1.00; it now names the value to set.
- **Factory turbo engines wore out on their own factory tune.** Bearing wear started
  at one average peak pressure for every engine (55 bar), so a stock B58 lost 1.4 points
  of bearing life per pull and every factory turbo car logged bottom-end stress. A
  bottom end is designed for its own service pressure: naturally aspirated ones are now
  free to 60 bar (stock pulls average 49-51) and factory turbo engines to 80 (their
  factory tunes average 60-70), with the advisory at 66 and 86. A turbo bolted onto a
  naturally aspirated engine keeps its NA bottom end and pays for it
  (`BEARING_PRESSURE_FREE_BAR`, `src/sim/coefficients.js`). Only bearing wear moves in
  the fingerprint.
- **The VQ35HR preset had 550 cc injectors**, leaving the stock engine at 44% duty.
  It now has the 315 cc option (the real part is about 290 cc) and runs 72% at peak,
  where a factory injector sits.
- **A warm restart fell through its own idle.** On the step the engine caught it was still
  just under the idle target, and the idle controller's damping read the starter's
  pull-up as a flare and shut the idle valve; the start hold then held it shut. The
  engine flared, fell to about 400 RPM and, on the stock VQ35DE, stalled. The idle air
  now never drops below its base value while starting (`src/sim/ecu/liveEcu.js`). A cold
  start hid it: the cold idle air and fuel carried the dip. LIVE only (the fingerprint
  covers the dyno pull), so no fingerprint change.

- **The knock model gave a stock pump-fuel engine far too much margin.** A 10.3:1 V6 on
  91 did not knock until about 7° past its best-torque timing at full throttle, and above
  6000 RPM could not be made to knock at all. Real 10-11:1 engines on pump fuel are
  knock-limited at full load through the low and middle revs and reach MBT only near
  peak power. The one fitted number, `KNOCK_TAU_SCALE`, had grown to 2.0 because two real
  effects were missing; with both modelled it is 1.1, within a tenth of the published
  Douaud & Eyzat correlation:
  - *Where the injectors spray.* Every engine carries its real injection system
    (`injection` on the engine: the VQ35DE and VQ35HR sequential multi-port; the N54
    piezo direct; the B58s solenoid direct; the North American EA888.3 GTI and Golf R
    direct only, where the European engine is dual). Port-injected fuel boils off the
    hot intake valve "with minimal impact on the charge temperature" (Bromberg, Cohn &
    Heywood, MIT LFEE 2006-01); direct injection cooled the charge 14 K more than port on
    gasoline and 49 K more on E85, about 70% of the adiabatic maximum (Kasseris &
    Heywood, SAE 2012-01-1275), and fills the cylinder 6% better (6% more power at
    low-speed full throttle, reviewed in InTech's *Gasoline Direct Injection*; 9% more VE
    on a research engine, Wyszynski, Stone & Kalghatgi, SAE 2002-01-0839). BUILD offers
    both. Single-point (throttle-body) manifold injection is not offered: no engine here
    used it, and its defining trait, uneven mixture cylinder to cylinder, needs a
    cylinder-by-cylinder model this one does not have.
  - *Pump fuel is not a reference fuel.* Douaud & Eyzat fitted their correlation on
    primary reference fuels, for which RON = MON. Each fuel now carries its RON and MON
    (91 AKI: 96/86; 93: 98/88; 100 race: 104/96; E85 at the EN 15293 minimums, 104/88),
    and the correlation reads Kalghatgi's octane index, OI = RON − K·(RON − MON), with K
    from the engine's own compression temperature at 15 bar placed between the RON test
    (K = 0) and the MON test (K = 1). Unfitted, it lands where Kalghatgi measured: about
    +0.1 to +0.4 on the port-injected NA engines, −0.05 to −0.42 on the boosted DI ones,
    against −0.38 averaged over 37 production engines at full throttle and −0.4 to −0.74
    on DI engines (Kalghatgi, Princeton CEFRC lecture 2018). Boosted, sensitive pump
    fuel resists knock better than its RON says; at part load, worse.

  The stock V6 on 91 is now knock-limited 3.7-4.1° below MBT from 1500 to 4500 RPM, 1°
  at 5500 and at MBT from 6000; 93 buys about a degree, in line with Kalghatgi's 0.6-1°
  per octane-index point. Every preset still makes its published power and torque
  knock-free (the EA888.3's unpublished cam duration was refitted from 210 to 200 for
  the direct injection's extra filling), and the turbo presets' factory spark at peak
  power fell from 16-23° to 12-17.5°, nearer the 8-12° seen in N54 and B58 logs.
- **The advisor and the factory calibration judged a turbo engine's part-throttle cells
  as if its air came straight from ambient.** The dyno and LIVE have a spooled turbo
  compressing, and heating, the air upstream of a part-open throttle, so a pull at the
  70 kPa setting ran 53 °C air and knocked on advice that said it would not. Both now
  grade those cells at the induction state that makes that manifold pressure
  (`inductionAtMap`, `src/sim/turbo.js`).
- **The knock integral jumped as spark moved.** It stopped counting on whole integration
  steps once 95% of the charge had burned, so it stepped by about 1% as the burn slid
  across the grid, and the knock-limit search could land a fraction of a degree past
  knock. The last step now counts only its share before the cutoff.
- **The pull log told the player to take out spark that spark could not fix.** Where the
  knock limit sits past the most retard a spark table holds (−5°), the knock entry now
  says so and points at boost, fuel and hardware instead, naming direct injection and an
  intercooler where the build lacks them.
- **A wet nitrous kit's own fuel was cooled like a port injector's.** It is sprayed into
  the airstream with the nitrous, so it now takes the nitrous's share of charge cooling.
- **Twin turbos had one compressor.** A twin setup doubled the turbine's flow area but
  left the air side at one compressor's flow, so a twin choked at half the air it should
  pass, and the N54 stood in a single Medium compressor for its pair. Both halves now
  scale with the count (`compressorWithCount`), the N54 is the two small TD03s it
  carries (its power and torque fit are unchanged), and the player could not fit a twin
  at all; now BUILD › Induction has a Single/Twin picker with a line comparing what the engine needs
  at the rev limit against where the compressors choke, in the lb/min turbo shops size by.
- **The Engineer Score passed a single Medium turbo on a 7 L V8.** The too-small rule
  matched on the size label past 4.2 L. It now compares the engine's airflow at the rev
  limit and peak boost (`turboAirflowNeedKgS`) with the compressors' choke flow, and the
  turbine's flow area with displacement, so it flags what the pull will show.
- **Nitrous fuel advice could be impossible.** Rich while spraying asked to lower a dry
  kit's fuel by 200 points from 100%, and a lean cut asked to raise it to 100% when it
  already was. The advice now stays within what the field can move, and when the base VE
  table is more than 8% off what the engine really fills, it sends the player to
  TUNE → AIRFLOW instead of hiding a base-tune error in the nitrous fuel.
- **The pull log's fixes read like a tuner's notes, in a tuner's order.** Every entry
  now names the screen and the table, uses the terms tuning software uses (timing, load
  rows, AFR target, injector flow rate, boost target, knock threshold) and gives a
  number to set. The log lists its entries setup → fuel → spark → boost → nitrous →
  hardware, the order a calibration is worked in, because the knock limit and best
  timing move with the mixture. Wrong advice it gave is gone: "lower VE" to fit the
  injectors (that leans the engine), boost "on BUILD" in one entry and "on TUNE →
  BOOST" in another (the base target is BUILD › Induction's curve), a 2.5-bar MAP
  sensor for an engine making 376 kPa, the VE table blamed for a rich mixture the
  injector scaling caused, and nitrous retard sized off false-knock retard.
- **Lean protection reported the wrong reading.** It quoted the wideband after the
  protection had pulled boost, so the log said "λ 0.96" against a λ 1.02 limit. It now
  reports the reading that tripped it.
- **Oxygen from nitrous now speeds the flame's start.** See approximation 14. The story
  nitrous job's reference fix needs 10° of retard while spraying where it needed 8.

These move 582 of the fingerprint's 678,605 values, all but two of them Engineer and pull
scores: boosted builds whose pull already logged underboost from a choked compressor are
now marked down 8 for it. The other two are the N54's part-load advice and fuel table,
each by under half a unit, from its compressors now being the pair it has. No power or
torque figure in the fingerprint moves; it carries no nitrous or twin-turbo case.
- **The Engineer Score gave a port-injected engine a direct-injected engine's compression
  allowance.** Factory port-injected turbo engines sit at 8.2-8.5:1 (EJ257, 2JZ-GTE,
  SR20DET) against 10.2-11.0:1 for direct-injected ones; the score now moves a point for
  injection type, both boosted and naturally aspirated (`COMPRESSION_DI_STEP`).

Together these regenerate the behavioural fingerprint. The bolt-on, spark-table and MAF
fixes above move it too: peak power falls a median 7% with all three bolt-ons and 2% with
the intake alone, is unchanged without mods, and 378 cases that ask a small turbo for more
than it can make now carry an underboost entry. Naturally aspirated results are
unchanged apart from exhaust temperature; boosted results move on average +1.7% (mild
boost) and −0.8% (heavy boost), with the largest moves on turbos far too small for their
engine, which previously made boost the compressor could not pass. The dew-point bound
moves only the fingerprint's grossly over-fuelled cells (850 cc injectors on a 315 cc
calibration, on E85), by at most one unit of power or torque.

## Career: how a job is graded

Every job is graded by `src/ui/career/evaluate.js` on the car as handed back: a
full-throttle pull at 100 kPa in the customer's conditions (whatever the bench was last
left on), plus a headless LIVE idle (a warm restart, judged once it settles) when the job
asks for one. Nothing is scored by a separate formula. Each story job is checked in
`tests/career.test.js`, and every generated template on every car it comes on at its
lowest and highest level in `tests/career-generated.test.js`, to fail as delivered and
to pass with a real fix made only with what the game shows the player. Engine-building
targets are set inside what real builds reach on this model (bolt-ons and a 240° cam
reach +15-21% naturally aspirated). `tests/career-economy.test.js` plays 70 days as a
player who fixes every car properly and holds the pacing: always work to take, never
broke, and the reputation ladder climbed over weeks.

- **Mixture is graded directly.** The pull log's lean event only fires past AFR 15.2, so a
  car can run 18% lean of its target with no event and a Tuning Score of 100. Jobs about
  fuelling therefore compare the wideband with the commanded AFR at every full-throttle
  point, within the percentage the job states.
- **Damage is judged per pull on the tune handed back**, not on the health the car lost
  while it was being diagnosed: a customer's car often arrives doing damage, and that is
  why it came in.
- **Without a dyno, a pull is a road test.** It logs everything a wideband and the ECU
  see, and hides horsepower on every screen. Power targets need a dyno.
- **What the career leaves out, and why.** There are no A/C jobs, because the A/C makes
  the stock idle noisy in this model, so an A/C complaint could not be told apart from a
  healthy car. There is no big-cam idle job, because no idle setting tried steadies a
  268° cam here. Both would be jobs with no fair answer.

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

The tutorial and Learn pass that followed rebuilt the tutorial around the live game
screens, and in doing so found and fixed: a pull-log MAF message that called a low-reading
MAF "running rich" when it runs lean; a bottom-end advisory set one bar above a stock
engine, so a cold air intake tripped it (now 66 bar: above every bolt-on NA pull, below
every factory-boosted engine); a "VS. LAST PULL" line that no screen has (the previous pull
is drawn dashed, labelled Prev); fix lines that named a TIMING or AFR page (the pages are
SPARK and FUEL); and four Learn articles cut off on a phone by a fixed-height expander. The
figures in the five-minute tutorial and the Tuning Course are computed from the simulator
when a lesson opens, so they cannot go stale.

What is not claimed: that every code comment in the repository was read sentence by
sentence. Comments that explain code rather than state a measured fact were not
re-verified, and a few real-world figures rest on practitioner sources, marked as such
above.


## One story across the screens

Found by driving the app screen by screen, not by reading it. Each was two screens telling a
player different things about the same engine.

- **The stock tune was flagged, and the dyno called it clean.** On the default engine, TUNE's
  advisor put three 40 kPa cells past the knock limit; a 100 kPa pull never runs that row, so
  the pull log said "Clean pull". Both were true and neither said so. The 70 and 40 kPa rows
  of the default table are now each cell's MBT, or the knock limit on 91 less TUNE's 1.5°
  margin where that is lower, as the advisor works them out (the first repair lowered only
  three cells, leaving a dip at 3500 rpm and six cells 2 to 6° past MBT, which TUNE also
  flags). The pull log now says when TUNE flags cells at a load the pull did not run, and the
  Tuning Score charges 2 points per such cell (at most 12) instead of reading "Dialed In 100"
  on a tune that knocks at part throttle. Which cells a pull "did not run" is judged against
  the player's own pull, at whatever load it ran (`cellsNotRunBy`): judged against TUNE's
  own full-throttle pull, a 40 kPa pull charged a knocking cell twice (once in its log, once
  as "not run") and said it had not run cells it had. `tests/stock-consistency.test.js` holds
  every preset, and the default engine at every pump octane, clean on TUNE at every cell, and
  the default engine and every preset free of past-MBT cells and of pull-log entries at 100,
  70 and 40 kPa.
- **RESET ALL TO STOCK wrote the Nissan V6's spark and fuel tables onto every engine.** On an
  N54, B58, GTI or 6.4 Hemi that is 18 to 27 cells past the knock limit and a pull that
  knocks. It now writes the factory-style calibration the physics generates for the hardware
  on the bench (`stockCalibrationFor`), the way a preset's own is made. The reset also takes
  the bolt-ons off, and it took the intercooler off with them, even from a factory turbo
  engine: an N54, B58 or EA888 then pulled with IAT and EGT protection in its log and up to
  100 whp down. An intercooler now stays while a turbo or supercharger is fitted
  (`stockModsOf`), as the turbo itself does, so RESET on an untouched preset gives back that
  preset's own tables exactly.
- **"N/A" on the status strip read as "not available".** Naturally aspirated is now "NA", and
  a non-boosted engine's BOOST reads "none".
- **LIVE showed "1.00 λ", "FUEL ON" and an idle-air trim on an engine that was off.** They
  read "—" until it cranks.
- **SANDBOX no longer opens on an engine nobody chose.** The default engine had the Nissan
  VQ35DE Rev-Up's bore, stroke and compression but not its cam, redline or power, so "custom
  build" and the Rev-Up preset were the same engine reporting 238 and 252 whp. SANDBOX now
  opens with no engine: a prebuilt one, or the player's own figures (`validateCustomEngine`).
  The bore, stroke, compression and cam ranges the form accepts are the ranges BUILD's
  sliders show, so a figure the form takes can always be seen and adjusted. They are the
  ranges the property and consistency tests build their random engines from (bore 75 to 105
  mm, stroke 65 to 102, compression 8.5 to 13). A first version accepted a 110 mm bore and
  14:1; those tests, widened to match, found engines where enrichment no longer cooled the
  exhaust and the ECU path no longer matched the open-loop model, so the form refuses them.
  The redline briefly stopped at 7500 rpm, where the tables then ended: an 11,000 rpm
  redline had been accepted, and above 7500 the pull read the last column's airflow at every
  speed and its power rose in a straight line with RPM. Tables are now sized to the engine
  and the form takes 11,000 rpm again, with the breathing, springs and bottom end worked out
  for it ("Engines past 7500 RPM" above).

What is still known to disagree: the rich-flame chemistry (October 2026, "Rich flames"
above) moved the power each pound of air makes into the real band and made enrichment cool
the exhaust; the big-bore boosted case that stayed flat (a 104.5 × 93.5 mm V8 at 11:1 and 10
psi, knock limit about 20° before MBT) now cools 37 °C from 12.5:1 to 11:1. Peak cylinder
pressure on boosted engines still reads low (approximation 7), best power sits a little lean
(approximation 4), and the factory tables are not checked against any maker's own
calibration file here, so no claim is made that they are within 3% of one.
Custom engines are checked against the five published high-revving engines above, not
against any engine's own dyno sheet.
