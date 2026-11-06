#!/usr/bin/env python3
"""Compare each engine preset's simulated dyno curve against its factory rating.

The Vitest suite (`tests/presets.test.js`) asserts pass/fail. This shows you WHERE a
preset is wrong — an engine can hit peak power and still have the wrong curve shape
or peak in the wrong place, which a single assertion cannot tell you. It is meant to
be run every time a preset's data (or the shared physics under it) changes, as the
fast feedback loop for re-fitting a preset — see `docs/superpowers/plans/` for the
"adjust preset DATA, re-measure" workflow this was built for.

Offline developer tooling: not shipped, not part of the build, not in CI. Python by
choice — this project's physics stays JavaScript (it runs in the browser), but
analysis tooling like this is free to use whatever is best for the job.

Usage:
    python3 scripts/analyze_presets.py            # table only
    python3 scripts/analyze_presets.py --plot      # also write preset-curves.png
    python3 scripts/analyze_presets.py --id n54    # inspect one preset's full curve
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# A tiny ESM shim: run every preset through the REAL simulation (the same
# `applyPreset` -> `simulateSweep` path the app and `tests/presets.test.js` use) and
# emit JSON. `DRIVETRAIN_EFF` is read from the sim itself rather than hardcoded here,
# so this script cannot silently drift from `src/sim/constants.js`.
COLLECT_JS = """
import * as S from './src/sim/index.js';

const out = {
  drivetrainEff: S.DRIVETRAIN_EFF,
  presets: S.ENGINE_PRESETS.map((preset) => {
    const patch = S.applyPreset(preset);
    const fuel = S.tankFuel(patch);
    const derived = S.deriveEngine(patch.engineConfig);
    const r = S.simulateSweep({
      loadKpa: 100,
      ve: patch.ve, veTruth: patch.ve,
      timing: patch.timing, afr: patch.afr,
      turboOn: patch.turboOn, boostCurve: patch.boostCurve,
      octaneBonus: fuel.bonus,
      octaneLabel: fuel.label,
      fuel,
      injectorCc: S.INJECTOR_OPTS[patch.injIdx].cc,
      ecuInjectorCc: patch.ecuInjectorCc,
      injectorLabel: S.INJECTOR_OPTS[patch.injIdx].label,
      mods: patch.mods, mafScalar: 1, derived,
      // `presetTurbine`, NOT `TURBINE_OPTS[turbineIdx]`. It applies the preset's
      // turbineCount, so a twin-turbo engine gets both turbos. Reading the option
      // straight out of the list drops the count and quietly under-flows the N54 by
      // ~7% — this script disagreeing with the test it claims to mirror, which is the
      // one thing it must never do.
      turbine: S.presetTurbine(preset),
      compressor: S.COMPRESSOR_OPTS[patch.compressorIdx],
    });
    return {
      id: preset.id,
      name: preset.name,
      factory: preset.factory,
      peakHp: r.peakHp,
      peakTq: r.peakTq,
      redline: preset.engine.redline,
      maxDuty: Math.max(...r.points.map((p) => p.duty)),
      knockEvents: r.events.filter((e) => e.type === 'knock').length,
      knockDetail: r.events.filter((e) => e.type === 'knock').map((e) => e.msg),
      curve: r.points.map((p) => ({ rpm: p.rpm, hp: p.hp, tq: p.torque, duty: p.duty })),
    };
  }),
};
process.stdout.write(JSON.stringify(out));
"""


def collect():
    """Run the JavaScript simulation and return its results as Python objects."""
    shim = REPO / ".preset-collect.mjs"
    shim.write_text(COLLECT_JS)
    try:
        proc = subprocess.run(
            ["node", str(shim)], cwd=REPO, capture_output=True, text=True, check=False
        )
        if proc.returncode != 0:
            sys.exit(f"simulation failed:\n{proc.stderr}")
        return json.loads(proc.stdout)
    finally:
        shim.unlink(missing_ok=True)


# There was a NO_PEAK_BEFORE_LIMITER map here, mirroring the one in
# tests/presets.test.js: the naturally aspirated presets whose power peak the model could
# not place, because nothing in the shared physics made VE fall at speed. Both said the
# entry was to be DELETED, not updated, the day the model gained the missing term. The
# inlet Mach index (issue #15) is that term, the test-side map is gone, and so is this
# one — every preset now goes through the ordinary rated-RPM check below.


def rated_rpm(value):
    """Format a rating that may be a point or a plateau band."""
    return f"{value[0]}-{value[1]}" if isinstance(value, list) else str(value)


def band(lo, hi):
    """Format an RPM band, collapsing it to one number when it is a single point."""
    return str(lo) if lo == hi else f"{lo}-{hi}"


def flat_top(curve):
    """The whole RPM band sharing the reported peak power, low to high.

    Reported hp is rounded to the whole number, so several RPM points routinely tie at
    the peak. Taking the first one makes a peak-location check turn on a rounding
    tie-break rather than on physics — which is exactly how a preset once certified a
    peak at 7200 on a curve that was still climbing at 7500. Compare against the band.
    """
    peak = max(p["hp"] for p in curve)
    tied = [p["rpm"] for p in curve if p["hp"] == peak]
    return min(tied), max(tied)


def peak_rpm_ok(result):
    """Whether the simulated power peak lands where the manufacturer says it does.

    Two cases, matching tests/presets.test.js: a plateau-rated engine's flat top must
    overlap the published band; a point-rated engine's published RPM must fall in or
    near its flat top.
    """
    curve = result["curve"]
    lo, hi = flat_top(curve)
    rated = result["factory"]["crankHpRpm"]
    if isinstance(rated, list):
        return lo <= rated[1] and hi >= rated[0]
    return lo - 500 <= rated <= hi + 500


def pct_err(sim, target):
    return (sim - target) / target * 100


def report(data):
    eff = data["drivetrainEff"]
    results = data["presets"]
    print(f"{'engine':<24} {'hp: sim/target':>16} {'err':>7} "
          f"{'rpm: flat top/rated':>19} "
          f"{'tq: sim/target':>16} {'err':>7} {'knock':>6} {'duty':>6}")
    print("-" * 112)
    ok = True
    for r in results:
        hpTarget = r["factory"]["crankHp"] * eff
        tqTarget = r["factory"]["crankTq"] * eff
        hpErr = pct_err(r["peakHp"], hpTarget)
        tqErr = pct_err(r["peakTq"], tqTarget)
        rpmOk = peak_rpm_ok(r)
        hpOk = abs(hpErr) <= 5
        tqOk = abs(tqErr) <= 10
        dutyOk = r["maxDuty"] < 90
        knockOk = r["knockEvents"] == 0
        rowOk = hpOk and tqOk and rpmOk and knockOk and dutyOk
        ok = ok and rowOk
        print(
            f"{r['name']:<24} "
            f"{r['peakHp']:>6}/{hpTarget:<6.0f} {hpErr:>6.1f}% "
            f"{band(*flat_top(r['curve'])):>9}/"
            f"{rated_rpm(r['factory']['crankHpRpm']):<9} "
            f"{r['peakTq']:>6}/{tqTarget:<6.0f} {tqErr:>6.1f}% "
            f"{r['knockEvents']:>6} {r['maxDuty']:>5}% "
            f"{'' if rowOk else '  <-- FIX'}"
        )
        if not rowOk:
            if not hpOk:
                print(f"    hp outside +-5%: {r['peakHp']} whp vs {hpTarget:.0f} whp target")
            if not tqOk:
                print(f"    tq outside +-10%: {r['peakTq']} wlb-ft vs {tqTarget:.0f} wlb-ft target")
            if not rpmOk:
                print(f"    peak hp across {band(*flat_top(r['curve']))} rpm, "
                      f"rated {rated_rpm(r['factory']['crankHpRpm'])}")
            if not knockOk:
                for msg in r["knockDetail"]:
                    print(f"    knock: {msg}")
            if not dutyOk:
                print(f"    injector duty hits {r['maxDuty']}% (wall is 90%)")
    print()
    print("all presets within tolerance" if ok else "one or more presets need work")
    return ok


def detail(data, preset_id):
    """Print the full RPM/hp/tq/duty curve for one preset — for seeing curve SHAPE,
    not just the peak, since a preset can hit peak power with the wrong shape."""
    match = next((r for r in data["presets"] if r["id"] == preset_id), None)
    if match is None:
        sys.exit(f"no such preset: {preset_id} (ids: {[r['id'] for r in data['presets']]})")
    print(f"{match['name']} — {match['factory']['crankHp']} crank hp @ "
          f"{rated_rpm(match['factory']['crankHpRpm'])}, "
          f"{match['factory']['crankTq']} lb-ft @ {match['factory']['crankTqRpm']}")
    print(f"{'rpm':>6} {'whp':>6} {'wlb-ft':>8} {'duty':>6}")
    for p in match["curve"]:
        print(f"{p['rpm']:>6} {p['hp']:>6} {p['tq']:>8} {p['duty']:>5}%")


def plot(data):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        sys.exit("matplotlib not installed: pip install matplotlib")

    results = data["presets"]
    eff = data["drivetrainEff"]
    fig, axes = plt.subplots(1, len(results), figsize=(5 * len(results), 4), squeeze=False)
    for ax, r in zip(axes[0], results):
        rpm = [p["rpm"] for p in r["curve"]]
        ax.plot(rpm, [p["hp"] for p in r["curve"]], label="whp")
        ax.plot(rpm, [p["tq"] for p in r["curve"]], label="wlb-ft")
        target = r["factory"]["crankHp"] * eff
        ax.axhline(target, linestyle="--", linewidth=1, color="gray", label=f"factory {target:.0f} whp")
        ax.set_title(r["name"], fontsize=10)
        ax.set_xlabel("RPM")
        ax.legend(fontsize=8)
        ax.grid(alpha=0.3)
    fig.tight_layout()
    out = REPO / "preset-curves.png"
    fig.savefig(out, dpi=120)
    print(f"wrote {out}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--plot", action="store_true", help="also write preset-curves.png")
    parser.add_argument("--id", help="print the full curve for one preset id (e.g. n54)")
    args = parser.parse_args()
    data = collect()
    if args.id:
        detail(data, args.id)
        return 0
    ok = report(data)
    if args.plot:
        plot(data)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
