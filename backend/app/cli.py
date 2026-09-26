"""Command line: run the pipeline on the provided cases and compare with the expected actions.

    python -m app.cli run --all            analyse every case and export workups to seed/
    python -m app.cli run CB-2025-0007     analyse one case
    python -m app.cli eval                 compare recommendations with eval/expected.json
"""

import argparse
import json
import sys

from . import db, pipeline
from .config import ROOT


def cmd_run(args) -> int:
    db.init()
    pipeline.seed(queue_missing=False, import_workups=False)  # regenerate, don't stack on old seeds
    ids = [c["case_id"] for c in db.list_cases()] if args.all else args.case_ids
    failed = 0
    for case_id in ids:
        print(f"  {case_id} ... ", end="", flush=True)
        try:
            w = pipeline.run(case_id)
            db.set_status(case_id, "ready")
            out = pipeline.export_seed(case_id)
            d = w["decision"]
            print(f"{d['action']:<22} conf={d['confidence']['level']:<6} "
                  f"{'NEEDS JUDGEMENT ' if d['needs_judgement'] else ''}-> {out.relative_to(ROOT)}")
        except Exception as e:
            failed += 1
            print(f"FAILED: {e}")
    return 1 if failed else 0


def cmd_eval(_args) -> int:
    db.init()
    pipeline.seed(queue_missing=False)
    expected = json.loads((ROOT / "eval" / "expected.json").read_text(encoding="utf-8"))
    rows, hits, cites, verified = [], 0, 0, 0
    for case_id, exp in expected.items():
        w = db.get_workup(case_id)
        if not w:
            rows.append((case_id, "-", exp["action"], "no workup"))
            continue
        action = w["decision"]["action"]
        ok = action in exp["acceptable"]
        hits += ok
        for r in w["requirements"]:
            for c in r["citations"]:
                cites += 1
                verified += c["verified"]
        rows.append((case_id, action, exp["action"], "ok" if ok else "MISMATCH"))
    print(f"\n{'case':<14}{'tool':<24}{'expected':<24}result")
    for r in rows:
        print(f"{r[0]:<14}{r[1]:<24}{r[2]:<24}{r[3]}")
    print(f"\nAction agreement: {hits}/{len(expected)}")
    if cites:
        print(f"Citations verified in source: {verified}/{cites} ({verified / cites:.0%})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run", help="Analyse cases")
    run.add_argument("case_ids", nargs="*")
    run.add_argument("--all", action="store_true")
    run.set_defaults(func=cmd_run)
    ev = sub.add_parser("eval", help="Compare with eval/expected.json")
    ev.set_defaults(func=cmd_eval)
    args = parser.parse_args()
    if args.cmd == "run" and not (args.all or args.case_ids):
        parser.error("give case ids or --all")
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
