#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import shutil
from dataclasses import replace
from pathlib import Path

from tqdm import tqdm
from dnadb import dna, fasta
import json


# -------------------------
# Helpers
# -------------------------

def clean_entry(entry: fasta.FastaEntry) -> fasta.FastaEntry:
    sequence = re.sub(rf"[^{dna.ALL_BASES}]", "", entry.sequence)
    return replace(entry, sequence=sequence)


# -------------------------
# Pipeline
# -------------------------

def run_prep(
    input_dir: Path,
    outdir: Path,
    min_length: int,
) -> dict:
    outdir.mkdir(parents=True, exist_ok=True)

    # Input files (same names as notebook)
    fasta_path = input_dir / "P_A_221205_cmfp.trim.contigs.pcr.good.unique.good.filter.unique.precluster.denovo.vsearch.pick.opti_mcc.0.03.pick.0.03.abund.0.03.pick.fasta"
    otu_list_path = input_dir / "221205_cmfp.trim.contigs.pcr.good.unique.good.filter.unique.precluster.denovo.vsearch.asv.list"
    otu_shared_path = input_dir / "221205_cmfp.trim.contigs.pcr.good.unique.good.filter.unique.precluster.denovo.vsearch.asv.shared"
    metadata_path = input_dir / "230320_sfdspatial_meta_clean.csv"
    taxonomy_path = input_dir / "taxonomy.tsv"

    # -------------------------
    # 1) FASTA DB
    # -------------------------
    fasta_db_path = outdir / "sequences.fasta.db"
    factory = fasta.FastaDbFactory(str(fasta_db_path))

    for entry in tqdm(
        map(clean_entry, fasta.entries(str(fasta_path))),
        desc="Writing FASTA DB",
    ):
        if len(entry) < min_length:
            continue
        factory.write_entry(entry)

    factory.close()
    fasta_db = fasta.FastaDb(str(fasta_db_path))

    # -------------------------
    # 2) OTU → sequence mapping
    # -------------------------
    with open(otu_list_path) as f:
        keys = f.readline().strip().split("\t")
        values = f.readline().strip().split("\t")

    otu_to_sequence_id = dict(zip(keys[2:], values[2:]))

    # -------------------------
    # 3) Sample mappings
    # -------------------------
    with open(otu_shared_path) as f:
        header = f.readline().strip().split("\t")

        otu_index_to_sequence_index = {
            i: fasta_db.sequence_id_to_index(otu_to_sequence_id[header[i]])
            for i in tqdm(range(3, len(header)), desc="Locating valid sequence IDs")
            if fasta_db.contains_sequence_id(otu_to_sequence_id[header[i]])
        }

        lines = (line.strip().split("\t") for line in f)
        mapping_db_path = outdir / "sequences.mapping.fasta.db"
        factory = fasta.FastaMappingDbFactory(str(mapping_db_path), fasta_db)

        for row in tqdm(lines, desc="Writing sample mappings"):
            sample_name = row[1]
            mapping = factory.create_entry(sample_name)

            for otu_index, sequence_index in otu_index_to_sequence_index.items():
                abundance = int(row[otu_index])
                if abundance > 0:
                    mapping.write_sequence_index(sequence_index, abundance)

            factory.write_entry(mapping)

        factory.close()

    # -------------------------
    # 4) Copy metadata
    # -------------------------
    shutil.copy(metadata_path, outdir / "metadata.csv")
    shutil.copy(taxonomy_path, outdir / "taxonomy.tsv")

    # -------------------------
    # Summary
    # -------------------------
    summary = {
        "status": "ok",
        "input_dir": str(input_dir),
        "outdir": str(outdir),
        "min_length": min_length,
        "artifacts": {
            "fasta_db": str(fasta_db_path),
            "mapping_db": str(outdir / "sequences.mapping.fasta.db"),
            "metadata": str(outdir / "metadata.csv"),
            "taxonomy": str(outdir / "taxonomy.tsv"),
        },
    }

    with open(outdir / "prep_result.json", "w") as f:
        json.dump(summary, f, indent=2)

    return summary


# -------------------------
# CLI
# -------------------------

def main():
    p = argparse.ArgumentParser(description="Prepare SFD 16S data for SetBERT")
    p.add_argument("--input-dir", required=True, type=Path)
    p.add_argument("--outdir", required=True, type=Path)
    p.add_argument("--min-length", type=int, default=150)
    args = p.parse_args()

    summary = run_prep(
        input_dir=args.input_dir,
        outdir=args.outdir,
        min_length=args.min_length,
    )

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
