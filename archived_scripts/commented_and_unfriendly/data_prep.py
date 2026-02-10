#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
from dataclasses import replace
from pathlib import Path

from tqdm import tqdm
from dnadb import dna, fasta


def clean_entry(entry: fasta.FastaEntry) -> fasta.FastaEntry:
    sequence = re.sub(rf"[^{dna.ALL_BASES}]", "", entry.sequence)
    return replace(entry, sequence=sequence)


def refuse_overwrite(path: Path, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError(f"Refusing to overwrite existing file: {path} (pass --force)")


def write_json(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")


def default_paths(input_dir: Path) -> dict[str, Path]:
    # Matches your notebook’s exact filenames.
    return {
        "fasta": input_dir / "P_A_221205_cmfp.trim.contigs.pcr.good.unique.good.filter.unique.precluster.denovo.vsearch.pick.opti_mcc.0.03.pick.0.03.abund.0.03.pick.fasta",
        "otu_list": input_dir / "221205_cmfp.trim.contigs.pcr.good.unique.good.filter.unique.precluster.denovo.vsearch.asv.list",
        "otu_shared": input_dir / "221205_cmfp.trim.contigs.pcr.good.unique.good.filter.unique.precluster.denovo.vsearch.asv.shared",
        "metadata": input_dir / "230320_sfdspatial_meta_clean.csv",
        "taxonomy": input_dir / "taxonomy.tsv",
    }


def build_fasta_db(fasta_path: Path, outdir: Path, min_length: int, force: bool) -> Path:
    outdir.mkdir(parents=True, exist_ok=True)
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

    write_json(outdir / "fasta_db_result.json", {
        "status": "ok",
        "step": "build_fasta_db",
        "input_fasta": str(fasta_path),
        "min_length": min_length,
        "counts": {"written": written, "skipped_short": skipped_short},
        "artifacts": {"fasta_db": str(fasta_db_path)},
    })

    return fasta_db_path


def build_mapping_db(
    fasta_db_path: Path,
    otu_list_path: Path,
    otu_shared_path: Path,
    outdir: Path,
    force: bool,
) -> Path:
    outdir.mkdir(parents=True, exist_ok=True)
    mapping_db_path = outdir / "sequences.mapping.fasta.db"
    refuse_overwrite(mapping_db_path, force=force)

    seq_db = fasta.FastaDb(str(fasta_db_path))

    # OTU list first two lines
    with open(otu_list_path, "r", encoding="utf-8") as f:
        keys = f.readline().strip().split("\t")
        values = f.readline().strip().split("\t")

    otu_to_sequence_id = dict(zip(keys[2:], values[2:]))

    with open(otu_shared_path, "r", encoding="utf-8") as f:
        header = f.readline().strip().split("\t")

        otu_index_to_sequence_index = {
            i: seq_db.sequence_id_to_index(otu_to_sequence_id[header[i]])
            for i in tqdm(range(3, len(header)), desc="Locating valid sequence IDs")
            if seq_db.contains_sequence_id(otu_to_sequence_id[header[i]])
        }

        lines = (line.strip().split("\t") for line in f)
        factory = fasta.FastaMappingDbFactory(str(mapping_db_path), seq_db)

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

    write_json(outdir / "mapping_db_result.json", {
        "status": "ok",
        "step": "build_mapping_db",
        "inputs": {
            "fasta_db": str(fasta_db_path),
            "otu_list": str(otu_list_path),
            "otu_shared": str(otu_shared_path),
        },
        "counts": {
            "samples_written": sample_count,
            "total_nonzero_entries": total_nonzero,
            "otu_columns_used": len(otu_index_to_sequence_index),
        },
        "artifacts": {"mapping_db": str(mapping_db_path)},
    })

    return mapping_db_path


def main() -> None:
    p = argparse.ArgumentParser(description="Prepare SFD 16S data into DNADB artifacts.")
    p.add_argument("--input-dir", required=True, type=Path, help="Directory containing raw input files")
    p.add_argument("--outdir", required=True, type=Path, help="Output directory")
    p.add_argument("--min-length", type=int, default=150)
    p.add_argument("--force", action="store_true", help="Overwrite existing outputs")

    # Optional overrides if you don't want the hardcoded notebook filenames
    p.add_argument("--fasta", type=Path)
    p.add_argument("--otu-list", type=Path)
    p.add_argument("--otu-shared", type=Path)
    p.add_argument("--metadata", type=Path)
    p.add_argument("--taxonomy", type=Path)

    args = p.parse_args()

    defaults = default_paths(args.input_dir)

    fasta_path = args.fasta or defaults["fasta"]
    otu_list_path = args.otu_list or defaults["otu_list"]
    otu_shared_path = args.otu_shared or defaults["otu_shared"]
    metadata_path = args.metadata or defaults["metadata"]
    taxonomy_path = args.taxonomy or defaults["taxonomy"]

    # Step A: FASTA DB
    fasta_db_path = build_fasta_db(fasta_path, args.outdir, args.min_length, args.force)

    # Step B: Mapping DB
    mapping_db_path = build_mapping_db(fasta_db_path, otu_list_path, otu_shared_path, args.outdir, args.force)

    # Copy metadata/taxonomy
    args.outdir.mkdir(parents=True, exist_ok=True)

    meta_dst = args.outdir / "metadata.csv"
    tax_dst = args.outdir / "taxonomy.tsv"

    if meta_dst.exists() and not args.force:
        raise FileExistsError(f"Refusing to overwrite existing file: {meta_dst} (pass --force)")
    if tax_dst.exists() and not args.force:
        raise FileExistsError(f"Refusing to overwrite existing file: {tax_dst} (pass --force)")

    shutil.copy(metadata_path, meta_dst)
    shutil.copy(taxonomy_path, tax_dst)

    summary = {
        "status": "ok",
        "step": "data_prep",
        "input_dir": str(args.input_dir),
        "outdir": str(args.outdir),
        "min_length": args.min_length,
        "artifacts": {
            "fasta_db": str(fasta_db_path),
            "mapping_db": str(mapping_db_path),
            "metadata": str(meta_dst),
            "taxonomy": str(tax_dst),
        },
    }
    write_json(args.outdir / "prep_result.json", summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()