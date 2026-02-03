#!/usr/bin/env python3

# We need to supply the follwing flags when executing
# python build_mapping_db.py \
#   --input-dir sfd-tutorial/data \
#   --outdir sfd-tutorial/dnadb

# if you wish to force overwrite supply the force flag as well such as follows
# python build_mapping_db.py \ --input ... \ --force

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from tqdm import tqdm
from dnadb import fasta

from prep_common import ensure_dir, refuse_overwrite, write_json, default_paths


def build_mapping_db(
    fasta_db_path: Path,
    otu_list_path: Path,
    otu_shared_path: Path,
    metadata_path: Path | None,
    taxonomy_path: Path | None,
    outdir: Path,
    force: bool,
) -> dict:
    ensure_dir(outdir)

    # Open FASTA DB
    fasta_db = fasta.FastaDb(str(fasta_db_path))

    # Read OTU list (first two lines)
    with open(otu_list_path, "r", encoding="utf-8") as f:
        keys = f.readline().strip().split("\t")
        values = f.readline().strip().split("\t")

    otu_to_sequence_id = dict(zip(keys[2:], values[2:]))

    # Build mapping DB
    mapping_db_path = outdir / "sequences.mapping.fasta.db"
    refuse_overwrite(mapping_db_path, force=force)

    with open(otu_shared_path, "r", encoding="utf-8") as f:
        header = f.readline().strip().split("\t")

        # Precompute OTU column index -> sequence index in FASTA DB
        otu_index_to_sequence_index = {
            i: fasta_db.sequence_id_to_index(otu_to_sequence_id[header[i]])
            for i in tqdm(range(3, len(header)), desc="Locating valid sequence IDs")
            if fasta_db.contains_sequence_id(otu_to_sequence_id[header[i]])
        }

        lines = (line.strip().split("\t") for line in f)
        factory = fasta.FastaMappingDbFactory(str(mapping_db_path), fasta_db)

        sample_count = 0
        total_nonzero = 0

        for row in tqdm(lines, desc="Writing sample mappings"):
            sample_name = row[1]
            mapping = factory.create_entry(sample_name)

            nz = 0
            for otu_index, sequence_index in otu_index_to_sequence_index.items():
                abundance = int(row[otu_index])
                if abundance > 0:
                    mapping.write_sequence_index(sequence_index, abundance)
                    nz += 1

            factory.write_entry(mapping)
            sample_count += 1
            total_nonzero += nz

        factory.close()

    # Copy metadata & taxonomy (optional)
    copied = {}
    if metadata_path is not None:
        dst = outdir / "metadata.csv"
        if dst.exists() and not force:
            raise FileExistsError(f"Refusing to overwrite existing file: {dst} (pass --force)")
        shutil.copy(metadata_path, dst)
        copied["metadata"] = str(dst)

    if taxonomy_path is not None:
        dst = outdir / "taxonomy.tsv"
        if dst.exists() and not force:
            raise FileExistsError(f"Refusing to overwrite existing file: {dst} (pass --force)")
        shutil.copy(taxonomy_path, dst)
        copied["taxonomy"] = str(dst)

    summary = {
        "status": "ok",
        "step": "build_mapping_db",
        "inputs": {
            "fasta_db": str(fasta_db_path),
            "otu_list": str(otu_list_path),
            "otu_shared": str(otu_shared_path),
            "metadata": str(metadata_path) if metadata_path else None,
            "taxonomy": str(taxonomy_path) if taxonomy_path else None,
        },
        "outdir": str(outdir),
        "counts": {
            "samples_written": sample_count,
            "total_nonzero_entries": total_nonzero,
            "otu_columns_used": len(otu_index_to_sequence_index),
        },
        "artifacts": {
            "mapping_db": str(mapping_db_path),
            **copied,
        },
    }

    write_json(outdir / "mapping_db_result.json", summary)
    return summary


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Build sequences.mapping.fasta.db using OTU list/shared and a FASTA DB.")
    p.add_argument("--input-dir", type=Path, help="Directory containing the SFD tutorial files")
    p.add_argument("--outdir", required=True, type=Path, help="Output directory (same as FASTA DB outdir is fine)")

    p.add_argument("--fasta-db", type=Path, help="Path to sequences.fasta.db (overrides default)")
    p.add_argument("--otu-list", type=Path, help="Path to .asv.list (overrides default)")
    p.add_argument("--otu-shared", type=Path, help="Path to .asv.shared (overrides default)")
    p.add_argument("--metadata", type=Path, help="Path to metadata CSV (overrides default)")
    p.add_argument("--taxonomy", type=Path, help="Path to taxonomy TSV (overrides default)")

    p.add_argument("--no-metadata", action="store_true", help="Do not copy metadata.csv")
    p.add_argument("--no-taxonomy", action="store_true", help="Do not copy taxonomy.tsv")

    p.add_argument("--force", action="store_true", help="Overwrite existing outputs")

    args = p.parse_args(argv)

    # Resolve defaults from input-dir if provided
    defaults = default_paths(args.input_dir) if args.input_dir else {}

    fasta_db_path = args.fasta_db or (args.outdir / "sequences.fasta.db")
    otu_list_path = args.otu_list or defaults.get("otu_list")
    otu_shared_path = args.otu_shared or defaults.get("otu_shared")

    if otu_list_path is None or otu_shared_path is None:
        p.error("Provide either --input-dir or explicit --otu-list and --otu-shared")

    metadata_path = None if args.no_metadata else (args.metadata or defaults.get("metadata"))
    taxonomy_path = None if args.no_taxonomy else (args.taxonomy or defaults.get("taxonomy"))

    summary = build_mapping_db(
        fasta_db_path=fasta_db_path,
        otu_list_path=otu_list_path,
        otu_shared_path=otu_shared_path,
        metadata_path=metadata_path,
        taxonomy_path=taxonomy_path,
        outdir=args.outdir,
        force=args.force,
    )

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
