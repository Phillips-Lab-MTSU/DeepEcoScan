#!/usr/bin/env python3

# We need to supply the follwing flags when executing
# python build_fasta_db.py \
#   --input-dir sfd-tutorial/data \
#   --outdir sfd-tutorial/dnadb \
#   --min-length 150
# python build_fasta_db.py \ --input ... \ --force


from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from tqdm import tqdm
from dnadb import fasta

from prep_common import clean_entry, ensure_dir, refuse_overwrite, write_json, default_paths


def build_fasta_db(
    fasta_path: Path,
    outdir: Path,
    min_length: int,
    force: bool,
) -> dict:
    ensure_dir(outdir)

    fasta_db_path = outdir / "sequences.fasta.db"
    refuse_overwrite(fasta_db_path, force=force)

    factory = fasta.FastaDbFactory(str(fasta_db_path))

    written = 0
    skipped_short = 0

    for entry in tqdm(map(clean_entry, fasta.entries(str(fasta_path))), desc="Writing FASTA DB"):
        if len(entry) < min_length:
            skipped_short += 1
            continue
        factory.write_entry(entry)
        written += 1

    factory.close()

    summary = {
        "status": "ok",
        "step": "build_fasta_db",
        "input_fasta": str(fasta_path),
        "outdir": str(outdir),
        "min_length": min_length,
        "counts": {
            "written": written,
            "skipped_short": skipped_short,
        },
        "artifacts": {
            "fasta_db": str(fasta_db_path),
        },
    }

    write_json(outdir / "fasta_db_result.json", summary)
    return summary


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Build sequences.fasta.db from an input FASTA.")
    p.add_argument("--input-dir", type=Path, help="Directory containing the SFD tutorial files")
    p.add_argument("--fasta", type=Path, help="Path to FASTA file (overrides --input-dir default)")
    p.add_argument("--outdir", required=True, type=Path, help="Output directory")
    p.add_argument("--min-length", type=int, default=150)
    p.add_argument("--force", action="store_true", help="Overwrite existing outputs")

    args = p.parse_args(argv)

    if args.fasta:
        fasta_path = args.fasta
    elif args.input_dir:
        fasta_path = default_paths(args.input_dir)["fasta"]
    else:
        p.error("Provide either --fasta or --input-dir")

    summary = build_fasta_db(
        fasta_path=fasta_path,
        outdir=args.outdir,
        min_length=args.min_length,
        force=args.force,
    )

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
