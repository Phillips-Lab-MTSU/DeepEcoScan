#!/usr/bin/env python3

# Use the user's default python3 (so this runs the same in terminals, venvs, etc.)
from __future__ import annotations
# Allows forward-references in type hints (handy for Path-like types and dataclasses)

import argparse
import json
import re
import shutil
from dataclasses import replace
from pathlib import Path

from tqdm import tqdm
from dnadb import dna, fasta


def clean_entry(entry: fasta.FastaEntry) -> fasta.FastaEntry:
    """
    Sanitize a FASTA entry's sequence so it only contains valid DNA bases.

    Why: Real-world FASTA files can include ambiguous bases (N), gaps (-),
    whitespace, or other symbols. DNADB expects sequences composed of known bases,
    so we strip everything not in dna.ALL_BASES.

    Note: This does NOT change the header/ID—only the sequence string.
    """
    # Remove any character not considered a valid base by dnadb's dna.ALL_BASES.
    sequence = re.sub(rf"[^{dna.ALL_BASES}]", "", entry.sequence)

    # dataclasses.replace creates a new entry with the updated sequence
    # (keeps everything else the same).
    return replace(entry, sequence=sequence)


def refuse_overwrite(path: Path, force: bool) -> None:
    """
    Guardrail against accidental data loss.

    If the output already exists and the user did not pass --force,
    crash early with a clear error message.
    """
    if path.exists() and not force:
        raise FileExistsError(f"Refusing to overwrite existing file: {path} (pass --force)")


def write_json(path: Path, obj: dict) -> None:
    """
    Write a small "result/summary" JSON file.

    These JSON artifacts are useful for:
      - debugging (what inputs were used?)
      - pipelines (downstream tools can read the summary)
      - reproducibility (counts and generated files are recorded)
    """
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")


def default_paths(input_dir: Path) -> dict[str, Path]:
    """
    Provide the default input filenames (matching the notebook this script came from).

    The script supports overrides via CLI flags, but if you don't provide them,
    these are the expected names inside --input-dir.
    """
    # Matches your notebook’s exact filenames.
    return {
        "fasta": input_dir / "P_A_221205_cmfp.trim.contigs.pcr.good.unique.good.filter.unique.precluster.denovo.vsearch.pick.opti_mcc.0.03.pick.0.03.abund.0.03.pick.fasta",
        "otu_list": input_dir / "221205_cmfp.trim.contigs.pcr.good.unique.good.filter.unique.precluster.denovo.vsearch.asv.list",
        "otu_shared": input_dir / "221205_cmfp.trim.contigs.pcr.good.unique.good.filter.unique.precluster.denovo.vsearch.asv.shared",
        "metadata": input_dir / "230320_sfdspatial_meta_clean.csv",
        "taxonomy": input_dir / "taxonomy.tsv",
    }


def build_fasta_db(fasta_path: Path, outdir: Path, min_length: int, force: bool) -> Path:
    """
    Step A: Build a DNADB FASTA database from an input FASTA file.

    What this produces:
      - sequences.fasta.db (binary/indexed DB created by dnadb)
      - fasta_db_result.json (counts + paths)

    Filtering:
      - sequences are "cleaned" to only include dna.ALL_BASES
      - sequences shorter than min_length are skipped
    """
    outdir.mkdir(parents=True, exist_ok=True)

    # This is the primary artifact from Step A.
    fasta_db_path = outdir / "sequences.fasta.db"

    # Prevent overwriting unless user explicitly requests it.
    refuse_overwrite(fasta_db_path, force=force)

    # Factory handles writing entries into DNADB's FASTA DB format.
    factory = fasta.FastaDbFactory(str(fasta_db_path))

    written = 0
    skipped_short = 0

    # fasta.entries() streams FASTA records; we map through clean_entry first.
    # tqdm wraps the iterator to show a progress bar while writing.
    for entry in tqdm(map(clean_entry, fasta.entries(str(fasta_path))), desc="Writing FASTA DB"):
        # The FastaEntry supports len(entry) as "sequence length".
        if len(entry) < min_length:
            skipped_short += 1
            continue

        # Write the cleaned, filtered entry into the database.
        factory.write_entry(entry)
        written += 1

    # Always close the factory to flush indexes + file handles.
    factory.close()

    # Save a machine-readable summary of what happened.
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
    """
    Step B: Build a DNADB "mapping DB" that links sample -> sequence abundances.

    Inputs used:
      - FASTA DB (to resolve sequence IDs -> internal sequence indexes)
      - OTU list file (maps OTU/ASV names to sequence IDs)
      - OTU shared file (matrix of abundances per sample per OTU)

    Output:
      - sequences.mapping.fasta.db (sample mappings to sequences + counts)
      - mapping_db_result.json (counts + paths)

    High-level idea:
      For each sample row in the shared file:
        create a mapping entry
        write only non-zero abundances for OTUs that exist in the FASTA DB
    """
    outdir.mkdir(parents=True, exist_ok=True)

    # This is the primary artifact from Step B.
    mapping_db_path = outdir / "sequences.mapping.fasta.db"

    # Prevent overwriting unless user explicitly requests it.
    refuse_overwrite(mapping_db_path, force=force)

    # Open the sequence DB so we can translate sequence IDs -> internal indexes.
    # (Mapping DB stores indexes for efficiency.)
    seq_db = fasta.FastaDb(str(fasta_db_path))

    # --- Read OTU list mapping ------------------------------------------------
    # The OTU list file is assumed to have:
    #   line 1: keys / column names (tab-separated)
    #   line 2: values (tab-separated)
    #
    # The script uses columns from index 2 onward (skipping the first two fields),
    # which matches the typical mothur-style formatting.
    with open(otu_list_path, "r", encoding="utf-8") as f:
        keys = f.readline().strip().split("\t")
        values = f.readline().strip().split("\t")

    # Build a dict: OTU_name -> sequence_id (as a string)
    otu_to_sequence_id = dict(zip(keys[2:], values[2:]))

    # --- Read OTU shared matrix & build mapping DB ----------------------------
    with open(otu_shared_path, "r", encoding="utf-8") as f:
        # The header contains OTU columns after the first few metadata columns.
        header = f.readline().strip().split("\t")

        # Precompute which OTU columns are valid AND exist in the FASTA DB.
        # We translate:
        #   shared file column index (otu_index) -> FASTA DB internal sequence index
        #
        # This avoids repeated lookups while processing each sample row.
        otu_index_to_sequence_index = {
            i: seq_db.sequence_id_to_index(otu_to_sequence_id[header[i]])
            for i in tqdm(range(3, len(header)), desc="Locating valid sequence IDs")
            # Only include OTUs whose sequence IDs are actually present in the FASTA DB.
            # (If not present, we silently drop that OTU column from consideration.)
            if seq_db.contains_sequence_id(otu_to_sequence_id[header[i]])
        }

        # Generator over remaining lines: each is a sample row split into columns.
        lines = (line.strip().split("\t") for line in f)

        # Factory to write sample->sequence mappings, tied to the existing seq_db.
        factory = fasta.FastaMappingDbFactory(str(mapping_db_path), seq_db)

        sample_count = 0
        total_nonzero = 0

        # Process every sample row and write its non-zero abundances.
        for row in tqdm(lines, desc="Writing sample mappings"):
            # Convention: row[1] is the sample name (row[0] is typically label/group).
            sample_name = row[1]

            # Create a new mapping entry for this sample.
            mapping = factory.create_entry(sample_name)

            nz = 0
            # For each OTU column we kept, read abundance and store if > 0.
            for otu_index, sequence_index in otu_index_to_sequence_index.items():
                abundance = int(row[otu_index])
                if abundance > 0:
                    # Store (sequence_index -> abundance) inside this sample mapping.
                    mapping.write_sequence_index(sequence_index, abundance)
                    nz += 1

            # Persist this sample's mapping into the mapping DB.
            factory.write_entry(mapping)

            sample_count += 1
            total_nonzero += nz

        # Close to flush indexes + file handles.
        factory.close()

    # Save a machine-readable summary of what happened.
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
    """
    CLI entry point.

    This script turns raw 16S processing outputs into a small set of DNADB artifacts:
      1) sequences.fasta.db            (cleaned + length-filtered sequences)
      2) sequences.mapping.fasta.db    (sample -> sequence abundance mappings)
      3) metadata.csv                 (copied as-is into output folder)
      4) taxonomy.tsv                 (copied as-is into output folder)
      5) JSON summaries for each step (for reproducibility + debugging)
    """
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

    # Load the notebook-style defaults, then allow CLI flags to override each one.
    defaults = default_paths(args.input_dir)

    fasta_path = args.fasta or defaults["fasta"]
    otu_list_path = args.otu_list or defaults["otu_list"]
    otu_shared_path = args.otu_shared or defaults["otu_shared"]
    metadata_path = args.metadata or defaults["metadata"]
    taxonomy_path = args.taxonomy or defaults["taxonomy"]

    # Step A: FASTA DB (clean + length-filter sequences into DNADB format)
    fasta_db_path = build_fasta_db(fasta_path, args.outdir, args.min_length, args.force)

    # Step B: Mapping DB (sample -> sequence abundance mapping)
    mapping_db_path = build_mapping_db(fasta_db_path, otu_list_path, otu_shared_path, args.outdir, args.force)

    # Copy metadata/taxonomy into the output folder so all artifacts live together.
    args.outdir.mkdir(parents=True, exist_ok=True)

    meta_dst = args.outdir / "metadata.csv"
    tax_dst = args.outdir / "taxonomy.tsv"

    # Same overwrite safety behavior as the DB artifacts.
    if meta_dst.exists() and not args.force:
        raise FileExistsError(f"Refusing to overwrite existing file: {meta_dst} (pass --force)")
    if tax_dst.exists() and not args.force:
        raise FileExistsError(f"Refusing to overwrite existing file: {tax_dst} (pass --force)")

    shutil.copy(metadata_path, meta_dst)
    shutil.copy(taxonomy_path, tax_dst)

    # Final end-to-end summary for the whole run (useful for pipelines/automation).
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

    # Print the same summary to stdout so users can see what got produced.
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    # Standard Python pattern: only run main() when executed directly,
    # not when imported as a module.
    main()
