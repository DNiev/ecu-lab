/**
 * HOME > Learn How It Works.
 *
 * The plain-language guide: twenty-eight collapsible articles, in reading order, from
 * "an engine is an air pump" through reading a time slip to the published
 * correlations the engine model implements and the limits it does not cross.
 *
 * It is the only screen in the app with NO state of its own and no store read —
 * every word of it is constant — so it is memoised. That matters here more than
 * anywhere: it is the largest block of markup on HOME, it sits next to the live
 * engine panel, and without the memo React would walk all twenty-eight articles twenty
 * times a second to produce exactly the same output. `active` and `onToggle` are its
 * only props, and `onToggle` is stable (see `toggleDashSection` in EcuLab.jsx), so
 * the default shallow comparison is enough.
 */

import { BookOpen } from 'lucide-react';
import React from 'react';

import { BuildSection } from '../../components/BuildSection.jsx';
import { ExpandableInfo } from '../../components/ExpandableInfo.jsx';

import styles from './LearnScreen.module.css';

/**
 * @param {object} props
 * @param {boolean} props.active whether this is HOME's open section
 * @param {(section: string) => void} props.onToggle opens or closes a HOME section
 * @returns {React.ReactElement}
 */
function LearnScreenInner({ active, onToggle }) {
  return (
    <BuildSection
      active={active} onClick={() => onToggle('learn')}
      icon={BookOpen} label="Learn How It Works"
      sub="Plain-language guide to engine tuning"
    >
      <div className={styles.intro}>Read in order. Each explains a piece of what the live engine is doing right now.</div>

      <div className={`${styles.part} ${styles.partFirst}`}>PART 1 · FUNDAMENTALS</div>

      <ExpandableInfo title="1. The whole thing in one paragraph">
        An engine is an air pump. However much air it swallows decides how much fuel can be burned, and burning fuel is what makes power. The ECU's entire job is to measure the air, add the right amount of fuel, and light it at the right moment. Tuning is adjusting those last two decisions.
        <br /><br />Everything else in this app — cams, turbos, exhaust diameter, compression — exists to change how much air gets in, or how much of that fuel's energy you can safely extract.
      </ExpandableInfo>

      <ExpandableInfo title="2. Volumetric efficiency — the master number">
        VE is how completely a cylinder fills compared to its own swept volume. At 100% VE the cylinder takes in exactly its displacement worth of air at the pressure available. Naturally aspirated engines typically peak around 85–100%; the peak sits at the RPM where the intake and exhaust tuning line up best, which is also where peak torque lands.
        <br /><br />VE falls off at high RPM because there simply is not enough time to fill the cylinder, and it falls at very low RPM because gas velocity is too low to help. That curve is the shape of your torque curve.
        <br /><br /><b className={styles.em}>Every hardware choice on BUILD moves this table</b> — cam duration slides the peak up or down the RPM range, headers and exhaust add flow up top, bore/stroke ratio biases the whole curve. That is why VE is where hardware becomes visible.
      </ExpandableInfo>

      <ExpandableInfo title="3. Lambda — the only mixture number that matters">
        Gasoline burns completely at about 14.7 parts air to 1 part fuel. Divide any AFR by its fuel's stoichiometric ratio and you get <b className={styles.em}>lambda</b>: 1.00 is exactly complete combustion, below 1 is rich, above 1 is lean.
        <br /><br />Lambda matters because it means the same thing on every fuel. E85 is stoichiometric at about 9.8:1, so 12.5:1 means something completely different on E85 than on pump gas — but lambda 0.85 is lambda 0.85 on both.
        <br /><br />Best power is slightly rich: around <b className={styles.em}>lambda 0.87</b> naturally aspirated, and richer still under boost — near 0.83 — because the extra fuel evaporating cools the charge and buys knock margin. Leaner than that under load and you lose power while raising both knock risk and exhaust temperature.
      </ExpandableInfo>

      <ExpandableInfo title="4. Why timing makes torque, and where it stops">
        Fuel does not explode instantly — it burns over a span of crank rotation. So the spark fires <i>before</i> top dead center, early enough that the burn is half finished just after the piston turns the corner.
        <br /><br />The number that matters is <b className={styles.em}>MFB50</b> — the crank angle where 50% of the fuel mass has burned. Put it about 8–10° after TDC and the pressure rise lands where the crank has leverage. This app targets 8.5°. <b className={styles.em}>MBT</b> — minimum spark for best torque — is not a number looked up in a table: it is simply whatever advance puts MFB50 there for the burn you actually have.
        <br /><br />Too advanced and pressure peaks while the piston is still rising, fighting the crank and cooking the end gas. Too retarded and you are still burning while the piston runs away: wasted energy, hot exhaust. Past MBT you gain almost nothing and risk everything.
        <br /><br />What moves MBT is <b className={styles.em}>burn duration</b>, and the surprise is what does not move it. Burn duration in crank degrees is roughly constant with engine speed — turbulence scales with piston speed, so the flame speeds up about as fast as the crank does. The two things a tuner genuinely moves it with are <b className={styles.em}>mixture</b> (fastest a little rich of stoichiometric, and falling away much faster on the lean side) and <b className={styles.em}>residual dilution</b> — leftover burned gas from the previous cycle, which slows the flame and demands more advance.
      </ExpandableInfo>

      <ExpandableInfo title="5. Knock — what actually destroys engines">
        Knock is the end gas — the mixture farthest from the spark plug — igniting on its own before the flame front reaches it. Two flame fronts collide and the pressure spike hammers the piston and ring lands.
        <br /><br />The part most explanations leave out is that knock is a <b className={styles.em}>race against time</b>, not a pressure threshold. At any pressure and temperature the end gas survives for a certain time before lighting itself. Every instant of the cycle uses up a slice of that time, and when the slices add up to one whole survival time, it goes. That is what this app runs: an ignition-delay correlation evaluated every crank angle, accumulated until it reaches 1.
        <br /><br />Two things fall straight out. <b className={styles.em}>Engine speed matters twice</b> — at higher RPM the same crank degrees are fewer milliseconds, so the end gas has less real time to autoignite at identical pressure. And <b className={styles.em}>retard is not purely protective</b>: it lowers peak pressure but drags the burn later, leaving the end gas hot for longer. Usually the pressure drop wins. Not always.
        <br /><br />What buys margin: higher octane, richer mixture, cooler charge, less compression, less boost. But these are not independent knobs being added up — a hot charge at high boost is far worse than "hot" plus "boosted", because both push the same exponential.
        <br /><br /><b className={styles.em}>How much is too much?</b> Tuners treat anything sustained above about 2° of retard as damaging, not as an operating point. Zero is the target.
      </ExpandableInfo>

      <div className={styles.part}>PART 2 · WHAT THE ECU CALCULATES</div>

      {/* Unnumbered, as it was in the reference build: a key to read the numbered
          articles by, not an article in the sequence. */}
      <ExpandableInfo title="Symbol key — plain-English version">
        Read this once and the formulas below stop looking like maths and start looking like a description of what the engine is doing.
        <br /><br /><b className={styles.em}>AIR SIDE</b>
        <br /><span className={styles.formula}>MAP</span> — manifold absolute pressure. <i>How hard the air is being pushed toward the cylinder.</i> About 101 kPa is atmospheric; 20-30 kPa at idle, because the throttle is shut and the engine pulls vacuum; above 101 means a turbo is pushing. Formulas need it in pascals, so kPa × 1000.
        <br /><br /><span className={styles.formula}>T</span> — charge temperature in <b className={styles.em}>kelvin</b>, not celsius: add 273.15 to your °C. It has to be absolute because at 0 K a gas has no volume; celsius has no such meaning, and the formula would break.
        <br /><br /><span className={styles.formula}>R</span> — the gas constant for air, 287 J/(kg·K). <i>A property of air itself</i> — never a tuning value; it is the same on every engine on earth.
        <br /><br /><span className={styles.formula}>ρ</span> (rho) — air density in kg/m³. <i>How much air is actually packed into a given space.</i> Cold, dense air is more oxygen and more possible power, which is why the same car makes more power on a cold night.
        <br /><br /><span className={styles.formula}>VE</span> — volumetric efficiency, as a fraction. <i>How good the engine is at filling its own cylinders.</i> A 95% cell means the cylinder took in 95% of what its volume could hold at that pressure.
        <br /><br /><span className={styles.formula}>V_cyl</span> — swept volume of ONE cylinder in m³ (displacement ÷ cylinders). <span className={styles.formula}>Vd</span> — the whole engine's displacement in m³: a 3.5 L engine is 0.0035 m³.
        <br /><br /><b className={styles.em}>FUEL SIDE</b>
        <br /><span className={styles.formula}>stoichRatio</span> — the air:fuel mass ratio at which fuel and oxygen exactly consume each other. <i>A chemical property of the fuel, not a choice:</i> 14.7:1 for gasoline, 9.8:1 for E85.
        <br /><br /><span className={styles.formula}>λ</span> (lambda) — measured AFR ÷ that fuel's stoichRatio. <i>How rich or lean you are, expressed so it means the same thing on any fuel.</i> 1.00 is exactly balanced, 0.85 is 15% more fuel than strictly needed — rich, and where power lives — and 1.10 is lean.
        <br /><br /><span className={styles.formula}>LHV</span> — lower heating value, J/kg. <i>How much energy is in a kilogram of the fuel.</i> Gasoline about 44 MJ/kg, E85 about 29.2 MJ/kg. E85 has less energy per kilogram but you burn far more kilograms, which is why the power comes out similar.
        <br /><br /><span className={styles.formula}>PW</span> — injector pulse width, milliseconds. <i>How long the injector is held open.</i> The ECU does not command fuel; it commands time.
        <br /><br /><b className={styles.em}>OUTPUT SIDE</b>
        <br /><span className={styles.formula}>CR</span> — compression ratio: 10.3 means the mixture is squeezed into 1/10.3 of its starting volume.
        <br /><br /><span className={styles.formula}>η</span> (eta) — thermal efficiency, a fraction between 0 and 1. <i>The share of the fuel's chemical energy that becomes work instead of heat out of the exhaust.</i> Around 0.35 is typical; most of a fuel's energy genuinely leaves as heat.
        <br /><br /><span className={styles.formula}>MEP</span> — mean effective pressure. <i>The single average pressure that, pushing on the piston for one stroke, would do the same work the real, varying pressure does.</i> It lets engines of different sizes be compared fairly, and comes in three kinds:
        <br /><span className={styles.formula}>IMEP</span> — what combustion produced on the piston
        <br /><span className={styles.formula}>FMEP</span> — what the engine spends on itself: rubbing friction, pumping air past a closed throttle, compressing valve springs
        <br /><span className={styles.formula}>BMEP</span> — what is left and reaches the crank, IMEP − FMEP
        <br />A healthy naturally aspirated engine peaks around 11-13 bar BMEP. Below zero, the engine cannot even pay for its own losses — which is exactly what engine braking is.
        <br /><br /><span className={styles.formula}>MBT</span> — minimum spark advance for best torque. <i>The least advance that still makes maximum power.</i> "Minimum" matters: past MBT you gain nothing and only add knock risk.
        <br /><br /><b className={styles.em}>TWO CONSTANTS THAT LOOK ARBITRARY</b>
        <br /><span className={styles.formula}>4π</span> in the torque formula: a four-stroke fires once every <b className={styles.em}>two</b> crank revolutions. Work per cycle is MEP × Vd, and two revolutions is 4π radians, so torque = work ÷ angle = MEP × Vd ÷ 4π. A two-stroke fires every revolution and uses 2π.
        <br /><br /><span className={styles.formula}>120000</span> in the duty-cycle formula: one injection per two revolutions. Two revolutions at N rpm take 2 ÷ (N/60) seconds = 120/N seconds = <b className={styles.em}>120000/N milliseconds</b>. At 7500 rpm that is 16 ms — the injector's whole time budget.
      </ExpandableInfo>

      <ExpandableInfo title="6. The control loop, in order">
        Thousands of times a minute, the ECU runs the same sequence:
        <br /><br />read sensors → calculate cylinder air mass → decide open or closed loop → work out required fuel mass → convert that to an injector pulse width → apply fuel trims → look up ignition timing → check for knock → retard if needed → fire injectors and coils → update learned values.
        <br /><br />Everything you edit in this app is one of the lookups inside that loop. The ECU is not deciding anything creative — it is doing arithmetic against your tables, very fast.
      </ExpandableInfo>

      <ExpandableInfo title="7. Step 1 — how much air is in the cylinder?">
        This is the ideal gas law, and it is the foundation of every speed-density calculation:
        <br /><br /><span className={styles.formula}>ρ = MAP ÷ (R × T)</span><br />
        <span className={styles.formula}>airCharge = VE × V_cylinder × ρ</span>
        <br /><br />MAP is manifold pressure (about 101 kPa at wide open naturally aspirated, higher with boost, down to ~20 kPa at idle). R is the gas constant for air, 287 J/(kg·K). T is charge temperature.
        <br /><br />Two consequences worth internalising. <b className={styles.em}>Boost raises MAP</b>, so it directly multiplies air mass. And <b className={styles.em}>compressing air heats it</b>, which lowers density and gives some of that gain back — which is the entire reason intercoolers exist. You can watch both in the datalog's MAP and IAT columns.
      </ExpandableInfo>

      <ExpandableInfo title="8. Step 2 — how much fuel does that need?">
        Fuel mass follows directly from air mass and your lambda target:
        <br /><br /><span className={styles.formula}>fuelMass = airCharge ÷ (λ × stoichRatio)</span>
        <br /><br />Nothing is fudged here. Because E85's stoichiometric ratio is 9.8 instead of 14.7, the same lambda target automatically demands about 1.5× the fuel mass — it falls straight out of the chemistry, which is why E85 needs a much bigger fuel system for the same power.
      </ExpandableInfo>

      <ExpandableInfo title="9. Step 3 — pulse width, and the hard time limit">
        The ECU never commands "fuel" — it commands a number of milliseconds. That comes from the required fuel mass and the injector's flow rating, plus deadtime (the ~1 ms an injector takes to physically open):
        <br /><br /><span className={styles.formula}>PW = fuelMass ÷ (injectorCC × density ÷ 60000) + deadtime</span><br />
        <span className={styles.formula}>cycleTime = 120000 ÷ RPM&nbsp;&nbsp;(ms per 720° cycle)</span><br />
        <span className={styles.formula}>duty% = PW ÷ cycleTime × 100</span>
        <br /><br />A four-stroke injects once every two crank revolutions, so at 7500 RPM there are only 16 ms in a cycle. An injector needing 15 of them is at 94% duty. Past about 90% there is no time left, and the mixture goes lean <i>no matter what your AFR table says</i>. This is a physical wall, not a calibration choice.
        <br /><br /><b className={styles.em}>Critical:</b> the ECU calculates that pulse width for the injector size it has been <i>told</i> is fitted. Fit bigger injectors without updating the ECU Injector Size on FUEL and every pulse delivers proportionally more fuel than intended — the engine runs rich everywhere regardless of your tables.
      </ExpandableInfo>

      <ExpandableInfo title="10. Step 4 — open loop, closed loop, and fuel trims">
        At part throttle the ECU runs <b className={styles.em}>closed loop</b>: it reads the oxygen sensor and corrects fuelling in real time. <b className={styles.em}>Short term fuel trim (STFT)</b> is that instant correction; <b className={styles.em}>long term fuel trim (LTFT)</b> is what it has learned and stored over time. Watch both on the HOME gauges — fit an intake without rescaling the MAF and you can see STFT swing, then hand off to LTFT as it learns.
        <br /><br />Above roughly 85 kPa the ECU switches to <b className={styles.em}>open loop</b> and stops listening to the O2 sensor entirely, following your tables blind. That is deliberate — at wide open throttle you want a rich power mixture, not stoichiometric.
        <br /><br />It is also why <b className={styles.em}>wide open throttle is where a bad tune bites</b>. Errors that closed loop quietly papers over at cruise pass straight through at full load.
      </ExpandableInfo>

      <ExpandableInfo title="11. Step 5 — from combustion to torque at the wheels">
        Fuel energy becomes indicated work on the piston, then the engine pays its own bills. The work is not estimated — the simulator integrates one cylinder through the closed part of its cycle, two crank degrees at a time:
        <br /><br /><span className={styles.formula}>dQ = Wiebe burn fraction × fuel energy</span><br />
        <span className={styles.formula}>dp = (γ−1)/V × dQ − γ × p/V × dV</span><br />
        <span className={styles.formula}>IMEP = ∮ p dV ÷ V_cyl</span><br />
        <span className={styles.formula}>PMEP = exhaust pressure − intake pressure</span><br />
        <span className={styles.formula}>BMEP = IMEP − friction − PMEP</span><br />
        <span className={styles.formula}>torque = BMEP × Vd ÷ 4π</span>
        <br /><br /><b className={styles.em}>Why integrate instead of multiply?</b> Because spark timing does not scale the work done — it moves <i>when</i> the heat arrives relative to a piston that is somewhere different at every crank angle. Burn too early and rising pressure fights the piston still coming up. Too late and the burn happens into a cylinder already expanding. MBT is where those two losses balance, and it falls out of the integration rather than being looked up.
        <br /><br />Raising compression makes power the honest way here: a smaller clearance volume means a longer expansion, and the integral simply comes out bigger.
        <br /><br /><b className={styles.em}>Pumping loss</b> is the one people forget: at part throttle the engine is working hard to breathe against a closed throttle, and that shows up as wasted work. Under boost it flips — if the turbine is not choking the exhaust harder than the compressor is filling the intake, the gas-exchange loop can actually hand work back.
      </ExpandableInfo>

      <div className={styles.part}>PART 3 · THE TUNING PROCESS</div>

      <ExpandableInfo title="12. The loop: change → pull → read → adjust">
        This is the whole method, and it is not a simplification:
        <br /><br /><b className={styles.em}>1. Change one thing.</b> One table region, one hardware item. Change three and you will not know which one mattered.
        <br /><br /><b className={styles.em}>2. Run a pull.</b> Nothing is known until it is measured. There is no preview in this app on purpose.
        <br /><br /><b className={styles.em}>3. Read the log first.</b> Before looking at the power number, read the Pull Log and check the datalog for gaps between commanded and actual. Power that came with 6° of knock retard is not power you keep.
        <br /><br /><b className={styles.em}>4. Adjust and repeat.</b> The VS. LAST PULL line tells you whether the change helped. Small logged steps beat big guesses, every time.
      </ExpandableInfo>

      <ExpandableInfo title="13. A worked example — first turbo tune">
        Fit a turbo on BUILD and run a pull without touching anything. It will score terribly, and here is why: a factory naturally-aspirated calibration has no real tuning above 101 kPa, so the boost rows are just a flat continuation of the wide-open-throttle row — far too much timing and far too lean for the cylinder pressure you have just created.
        <br /><br /><b className={styles.em}>Read the log.</b> It will report knock across most of the range, with the RPM band and how many degrees the ECU pulled.
        <br /><br /><b className={styles.em}>Fix the spark first.</b> On SPARK, pull the 150 and 200 kPa rows down. Roughly 2° per 20 kPa of extra pressure is a sane starting point. Pull again.
        <br /><br /><b className={styles.em}>Then the mixture.</b> On FUEL, richen those same rows toward lambda 0.83 (about 12.2:1). Pull again — you should see knock margin improve as well, because a richer charge resists knock.
        <br /><br /><b className={styles.em}>Then check the fuel system.</b> If the log reports injectors maxed, that is hardware: fit bigger injectors and set the matching ECU Injector Size, or ask for less boost. Nothing in the tables can create fuel that the injectors have no time to deliver.
      </ExpandableInfo>

      <ExpandableInfo title="14. How to read the datalog columns">
        The datalog is where diagnosis actually happens. Read it in pairs:
        <br /><br /><b className={styles.em}>Timing: asked → got</b> — if they differ, the ECU overrode you. That is knock retard, and the gap is how far past the limit your table was.
        <br /><br /><b className={styles.em}>Mixture: asked → got</b> — if actual is not what you commanded, the cause is upstream of the fuel table: usually MAF scaling or injectors out of duty. Do not "fix" it by editing fuel cells; fix the cause.
        <br /><br /><b className={styles.em}>Airflow</b> — around 200 g/s is typical at redline for an engine near 300 hp, which is a quick sanity check on whether your VE table is plausible.
        <br /><br /><b className={styles.em}>Injectors</b> — duty above 90% is the wall. <b className={styles.em}>Heat</b> — sustained EGT above ~980°C cooks turbines and valves; it rises hard with retarded timing and lean mixtures, and a rich mixture is what pulls it back down.
      </ExpandableInfo>

      <ExpandableInfo title="15. What tuning can fix, and what it can't">
        <b className={styles.em}>Calibration faults — tables fix these completely:</b> knock (pull timing), lean or rich mixture (AFR table), MAF drift after an intake change (MAF scalar), injector mismatch (set the ECU injector size). Fix the cause and the score returns to 100.
        <br /><br /><b className={styles.em}>Physical limits — no table touches these:</b> injectors out of duty cycle, valve float, a compressor past its efficient range, a cam that has moved the powerband somewhere you did not want. The Pull Log always names both routes when you hit one: change the hardware, or ask less of it.
        <br /><br />Knowing which kind of problem you are looking at is most of what separates a tuner from someone guessing at numbers.
      </ExpandableInfo>

      <ExpandableInfo title="16. Habits that keep engines alive">
        Target zero knock, not "acceptable" knock. Stay on the rich side of best power until you have confirmed margin. Never chase a number you have not measured. When something looks wrong, find the cause rather than compensating for it downstream — a MAF error corrected by bending the AFR table will be wrong again the moment load changes.
        <br /><br />And watch engine health on HOME. Damage here accumulates the way it does in reality: a few destructive pulls, not one dramatic failure.
      </ExpandableInfo>

      <div className={styles.part}>PART 4 · GETTING IT TO THE GROUND</div>

      <ExpandableInfo title="17. A torque curve is only half of acceleration">
        Everything up to here has been about making torque. The DRAG page is about what happens to it next, and it runs on four equations:
        <br /><br /><span className={styles.formula}>wheelTorque = engineTorque × gearRatio × finalDrive</span><br />
        <span className={styles.formula}>F_max = μ × N</span><br />
        <span className={styles.formula}>ΔN = m × a × h ÷ L</span><br />
        <span className={styles.formula}>F_aero = ½ × ρ × Cd × A × v²</span>
        <br /><br />Gearing multiplies torque and divides speed by exactly the same factor. Grip sets a hard ceiling no amount of power can pass. Weight transfer raises that ceiling as you accelerate. Aerodynamic drag rises with the square of speed, so it is nothing at the line and everything at the trap.
        <br /><br />This is why two engines with the same peak horsepower can run very different times, and why the <i>shape</i> of a powerband — how much area is under the curve, and where — matters more than its highest point.
      </ExpandableInfo>

      <ExpandableInfo title="18. Gearing — torque multiplication, and what it costs">
        A 3.79 first gear with a 3.54 final drive multiplies engine torque by <b className={styles.em}>13.4×</b> before it reaches the tyre. Nothing about the engine changed; that multiplication is why first gear lights the tyres and sixth cannot.
        <br /><br />The trade is exact. The same ratio divides road speed by 13.4, so you run out of revs almost immediately. Gearing never creates energy — it trades force against speed:
        <br /><br /><span className={styles.formula}>v = RPM × 2π × tyreRadius ÷ (60 × gearRatio × finalDrive)</span>
        <br /><br />There is a second cost people forget. The engine, gearbox and wheels have to be spun up as well as pushed along, so they act as extra mass — and referred to the road that inertia scales with the <b className={styles.em}>square</b> of the ratio. A very short first gear can add twenty per cent to a car's effective weight while it is engaged, and by top gear that penalty has almost vanished. It is also why lighter wheels help more than the same weight taken out of the boot: wheel inertia is geared to the road at 1:1 in every gear.
        <br /><br />Choosing ratios is really choosing where in the rev range you spend your time. Keep the engine near peak torque as much as possible and you will beat a car with more peak power that falls out of its band on every shift.
      </ExpandableInfo>

      <ExpandableInfo title="19. Grip — the ceiling nothing gets past">
        Torque you cannot transmit is just smoke:
        <br /><br /><span className={styles.formula}>F_max = μ × N</span>
        <br /><br />Measured values: street tyres <b className={styles.em}>0.8–0.9</b>, good summer tyres near <b className={styles.em}>1.0</b>, racing slicks <b className={styles.em}>1.7–1.9</b>, prepared drag surfaces higher again. Since F = ma, μ is directly a ceiling on acceleration in g — and on a rear-drive car only about 47% of the weight sits over the driven axle at rest, so the real launch limit is far below even that.
        <br /><br /><b className={styles.em}>Weight transfer is what rescues it.</b> Accelerating shifts load rearward by ΔN = m·a·h ÷ L, so grip grows with the very acceleration it enables. That is why a rear-drive car out-launches its static weight distribution, why a taller centre of gravity genuinely helps at the strip even though it hurts everywhere else, and why all-wheel drive wins anyway — it starts with every kilogram already over a driven wheel.
        <br /><br /><b className={styles.em}>One result surprises people.</b> When the tyre is the limit, every term carries the mass and it cancels:
        <br /><br /><span className={styles.formula}>a = μ·g·f ÷ (1 − μ·h/L)</span>
        <br /><br />Adding weight to a car that is already spinning its tyres does not slow the launch at all. It slows everything after it, once grip stops being what is holding the car back. You can watch this on the DRAG page: put a huge engine on street tyres, then change the body, and the 60-foot time barely moves while the ET does.
      </ExpandableInfo>

      <ExpandableInfo title="20. What actually slows the car down">
        Three forces oppose you, and they dominate at different points on the strip.
        <br /><br /><span className={styles.formula}>F_aero = ½ × ρ × Cd × A × v²</span>
        <br /><br />Aerodynamic drag rises with the <b className={styles.em}>square</b> of speed — double the speed, quadruple the force. It is almost nothing at launch and enormous at the trap, which is exactly why trap speed is a far better measure of power than elapsed time, and why elapsed time is dominated by traction and gearing instead. The ρ here is the same air density the engine model uses, from the same gas law.
        <br /><br /><span className={styles.formula}>F_roll = Crr × m × g</span>
        <br /><br />Rolling resistance is roughly constant, typically 1–1.5% of weight, and matters most where drag does not.
        <br /><br />And whatever is left over is acceleration: <span className={styles.formula}>a = (F_tractive − F_aero − F_roll) ÷ m_effective</span>
      </ExpandableInfo>

      <ExpandableInfo title="21. Reading a time slip">
        A time slip is a datalog, and it is read the same way — in pairs, looking for which number disagrees with which.
        <br /><br /><b className={styles.em}>Sixty-foot time</b> is the launch: traction, gearing, and how well the car left the line. It is the single biggest lever on elapsed time for most street cars, and it has almost nothing to do with peak power.
        <br /><br /><b className={styles.em}>Trap speed</b> is power to weight, because at the far end drag dominates and only sustained power holds speed against it. Two cars can share an elapsed time with very different trap speeds — the one trapping faster has more power and launched worse.
        <br /><br /><b className={styles.em}>Elapsed time</b> is the combination, so improving it means working out which half is costing you. High trap but poor ET means grip and gearing, not more boost. Low trap means you actually need power. That is the same diagnostic habit as reading a pull log: find the cause, do not compensate for it downstream.
      </ExpandableInfo>

      <div className={styles.part}>PART 5 · WHAT THE SIMULATOR IS DOING</div>

      <ExpandableInfo title="22. The turbo is a machine, not a boost knob">
        A compressor is not a pump that delivers whatever number you type. It is a wheel with a <b className={styles.em}>map</b>: for a given pressure ratio it can only pass so much air, and it is only efficient in the middle of that map.
        <br /><br />Off the left edge is <b className={styles.em}>surge</b> — too little flow for the pressure being asked, and the air stalls off the blades and reverses. Off the right edge is <b className={styles.em}>choke</b>, and this one is a hard wall rather than a penalty: once the inducer reaches the speed of sound, no more air goes through it at any shaft speed. Asking for more boost past that point does nothing at all.
        <br /><br />What actually sets boost is an <b className={styles.em}>energy balance</b>. The turbine takes power out of the exhaust; the compressor spends it on the intake. Boost is wherever those two settle. That is why exhaust temperature and turbine size change boost without you touching the target, and why a wastegate lowers backpressure the moment it cracks open.
        <br /><br />So when the app refuses you boost, it is not a rule — it is the hardware. Change the turbine, the compressor, or how much exhaust energy you are making.
      </ExpandableInfo>

      <ExpandableInfo title="23. What boost costs: pumping work and backpressure">
        Boost is usually taught as free power. It is not, and the bill arrives in two places.
        <br /><br />First, <b className={styles.em}>pumping work</b>. Every cycle the engine has to push the exhaust out against whatever pressure is in the manifold and draw the next charge in. The cost is the difference between exhaust pressure and intake pressure. With a small or nearly choked turbine, exhaust manifold pressure can run well above boost pressure — so the engine is pushing out harder than it is being fed, and that is a straight torque loss before the crank sees anything.
        <br /><br />Second, <b className={styles.em}>residuals</b>. High exhaust pressure relative to intake pressure means more burned gas stays behind, or backflows during overlap. That hot, inert leftover does two things: it slows the flame (so MBT moves, see article 4) and it raises the starting temperature of the next charge — which feeds straight into the knock clock from article 5.
        <br /><br />This is the real reason turbine sizing matters, and why two setups making identical boost can be nothing alike to drive.
      </ExpandableInfo>

      <ExpandableInfo title="24. Where the heat actually goes">
        Burning fuel does not hand all its energy to the piston. A large share goes through the chamber walls to the coolant, and the rate depends on how fast the gas is moving and how hot it is — not on a fixed percentage.
        <br /><br />This app uses the standard correlation for that (Woschni), against a wall at roughly 450 K and an area that grows as the piston uncovers the bore. Heat loss is therefore worst where gas velocity and temperature are highest: right around peak pressure.
        <br /><br />The other thing most simple models get wrong is that burned and unburned gas are not the same substance. Hot burned products have a lower ratio of specific heats than cool unburned charge. Treating the whole cylinder as unburned air overstates peak pressure by roughly 15%. This app carries <b className={styles.em}>two zones</b> and blends between them by how much has burned so far, with dissociation — high-temperature products soaking up energy — folded in as a ceiling on how far the temperature can run.
        <br /><br />That is why the exhaust gas temperature in the datalog responds to timing the way it does: retard leaves more heat release happening late, and the gas leaves before it has given it up.
      </ExpandableInfo>

      <ExpandableInfo title="25. Why the textbook Otto cycle is not your engine">
        Physics classes teach the <b className={styles.em}>air-standard Otto cycle</b>, whose efficiency is a famously tidy formula depending on compression ratio alone. Interactive versions are worth playing with — see article 27 — because they build the right intuition about compression and about why heat must be thrown away.
        <br /><br />But NASA's own primer states the assumptions plainly: no heat crossing the walls, no friction, and "instantaneous burning occurring at constant volume". Your engine does none of those. Combustion takes 40-odd crank degrees, heat leaves through the walls the whole time (article 24), the working fluid changes composition as it burns, the cylinder never empties cleanly (article 23), and spark timing has consequences (article 5).
        <br /><br />Every one of those is a place a real engine loses efficiency — and every one is a place a <b className={styles.em}>tuner has leverage</b>. If the ideal cycle were accurate there would be nothing to tune but compression ratio.
        <br /><br />NASA adds that real losses "are normally accounted for by efficiency factors which multiply and modify the ideal result". That multiply-by-a-factor approach is exactly what this app used to do and no longer does: it integrates pressure through the cycle and takes the work out. The fitted realization factor was deleted once the cycle was solved properly.
      </ExpandableInfo>

      <ExpandableInfo title="26. Where the engine model comes from">
        The physics is not invented for this app. It implements published correlations, so the numbers can be checked against the literature rather than taken on trust.
        <br /><br /><b className={styles.em}>Combustion.</b> Wiebe (Vibe) function for mass-burned fraction. Heywood, <i>Internal Combustion Engine Fundamentals</i> (McGraw-Hill, 2nd ed. 2018) for the two-zone treatment and the 8–10° ATDC MFB50 optimum in article 4.
        <br /><br /><b className={styles.em}>Knock.</b> Douaud &amp; Eyzat, "Four-Octane-Number Method for Predicting the Anti-Knock Behavior of Fuels and Engines", SAE 780080 (1978) — the ignition-delay correlation. Livengood &amp; Wu, 5th Symposium on Combustion (1955) — the integral that accumulates it. Together these are article 5.
        <br /><br /><b className={styles.em}>Heat transfer.</b> Woschni, SAE 670931 (1967). Article 24.
        <br /><br /><b className={styles.em}>Control and gas exchange.</b> Guzzella &amp; Onder, <i>Introduction to Modeling and Control of Internal Combustion Engine Systems</i> (Springer, 2nd ed. 2010). Eriksson &amp; Nielsen, <i>Modeling and Control of Engine and Drivetrain Systems</i> (Wiley, 2014). Blair, <i>Design and Simulation of Four-Stroke Engines</i> (SAE, 1999).
      </ExpandableInfo>

      <ExpandableInfo title="27. Further reading, if you want the fundamentals first">
        This app starts partway up. If the ideal cycle or the chemistry is new to you, these are better first stops.
        <br /><br /><b className={styles.em}>The ideal cycle.</b> NASA Glenn's Beginner's Guide sets out the Otto cycle and names its assumptions. PhysSandbox has interactive P–V comparisons of the Otto, Diesel, Carnot and Stirling cycles. New3JCN publishes 350+ browser physics simulations under CC BY 4.0, including gas laws and P–V diagrams.
        <br /><br /><b className={styles.em}>Combustion chemistry.</b> Argonne National Laboratory's combustion programme, for how detailed reaction kinetics and fuel autoignition are actually modelled — the research-grade version of what article 5 approximates.
        <br /><br /><b className={styles.em}>Engines and emissions generally.</b> The US Department of Energy's internal combustion engine overview, and the Royal Society of Chemistry's material on the chemistry of car engines, for combustion products and aftertreatment — the subject article 28 explains this app leaves out.
      </ExpandableInfo>

      <ExpandableInfo title="28. What this model does not do">
        An accurate simulator is worth more if it is honest about its edges. Three matter.
        <br /><br /><b className={styles.em}>Autoignition is a correlation, not chemistry.</b> Article 5's survival time comes from a published empirical fit — the standard engineering approach, good across normal running. But real autoignition is a branching chain reaction through hundreds of intermediate species, and it does something the fit cannot: over one band of temperature gasoline gets <i>harder</i> to ignite as it gets hotter, and can light in two stages. Laboratories model this with detailed kinetic mechanisms and large computers. A browser cannot.
        <br /><br /><b className={styles.em}>There is no emissions chemistry.</b> Nothing here computes NOx, carbon monoxide or unburned hydrocarbons. So the app can say what lambda does to power and to knock, but never what it does to what leaves the pipe. Worth knowing: the narrow band around lambda 1.00 exists mainly because a three-way catalyst only converts all three pollutants at once inside it. Closed loop is an emissions strategy first.
        <br /><br /><b className={styles.em}>Fuel is a few properties, not a mixture.</b> Pump gasoline blends hundreds of hydrocarbons. Here each fuel carries a stoichiometric ratio, density, heating value, latent heat and antiknock index — enough for a tuner's decisions, not enough to say anything about distillation or seasonal blending.
      </ExpandableInfo>
    </BuildSection>
  );
}

export const LearnScreen = React.memo(LearnScreenInner);
