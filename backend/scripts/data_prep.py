#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

# valid dna bases we want to keep after cleaning
VALID_BASES = set("ACGTN")


# writes a python dictionary to a json file
def write_json(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")


# cleans a sequence by:
# 1. converting to uppercase
# 2. removing any characters not in VALID_BASES
def clean_sequence(seq: str) -> str:
    seq = seq.upper()
    return "".join(ch for ch in seq if ch in VALID_BASES)


# reads a fasta file and yields one sequence at a time
# each result is returned as: (header, sequence)
def parse_fasta(path: Path):
    header = None
    seq_chunks = []

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()

            # skip blank lines
            if not line:
                continue

            # a new header means the previous sequence is complete
            if line.startswith(">"):
                if header is not None:
                    yield header, "".join(seq_chunks)

                # save new header without the > character
                header = line[1:].strip()
                seq_chunks = []
            else:
                # collect sequence lines until the next header
                seq_chunks.append(line)

        # yield the last sequence after the loop ends
        if header is not None:
            yield header, "".join(seq_chunks)


# reads a fastq file and yields one sequence at a time
# fastq records come in groups of 4 lines:
# 1. header
# 2. sequence
# 3. plus line
# 4. quality line
def parse_fastq(path: Path):
    with path.open("r", encoding="utf-8") as f:
        while True:
            header = f.readline()
            if not header:
                break

            seq = f.readline()
            plus = f.readline()
            qual = f.readline()

            # stop if file is incomplete
            if not seq or not plus or not qual:
                break

            header = header.strip()
            seq = seq.strip()

            # only accept valid fastq headers
            if header.startswith("@"):
                yield header[1:].strip(), seq


# detects file type based on extension
def detect_format(path: Path) -> str:
    ext = path.suffix.lower()

    if ext in [".fasta", ".fa", ".fna"]:
        return "fasta"

    if ext in [".fastq", ".fq"]:
        return "fastq"

    # if extension is not supported, stop with an error
    raise ValueError(f"Unsupported input format: {ext}")


def main() -> None:
    # command line argument setup
    parser = argparse.ArgumentParser(
        description="Prepare uploaded sequence file for DeepEcoScan pipeline."
    )

    # input file path
    parser.add_argument(
        "--input",
        required=True,
        type=Path,
        help="Uploaded FASTA/FASTQ file"
    )

    # output folder for generated files
    parser.add_argument(
        "--outdir",
        required=True,
        type=Path,
        help="Prep output directory"
    )

    # minimum sequence length to keep
    parser.add_argument("--min-length", type=int, default=150)

    # allows overwriting old output files
    parser.add_argument("--force", action="store_true")

    args = parser.parse_args()

    # create output directory if it does not exist
    args.outdir.mkdir(parents=True, exist_ok=True)

    # output files
    cleaned_fasta = args.outdir / "sequences.fasta.cleaned"
    result_json = args.outdir / "prep_result.json"

    # prevent accidental overwrite unless --force is used
    if cleaned_fasta.exists() and not args.force:
        raise FileExistsError(
            f"Refusing to overwrite existing file: {cleaned_fasta} (pass --force)"
        )

    if result_json.exists() and not args.force:
        raise FileExistsError(
            f"Refusing to overwrite existing file: {result_json} (pass --force)"
        )

    # detect input format and choose the correct parser
    fmt = detect_format(args.input)
    parser_fn = parse_fasta if fmt == "fasta" else parse_fastq

    # counters for summary info
    total = 0
    kept = 0
    skipped_short = 0
    sample_headers = []

    # open cleaned fasta output file
    with cleaned_fasta.open("w", encoding="utf-8") as out:
        for header, seq in parser_fn(args.input):
            total += 1

            # clean the sequence before checking its length
            cleaned = clean_sequence(seq)

            # skip sequences that are too short
            if len(cleaned) < args.min_length:
                skipped_short += 1
                continue

            kept += 1

            # save up to 5 sample headers for preview/debugging
            if len(sample_headers) < 5:
                sample_headers.append(header)

            # write cleaned sequence in fasta format
            out.write(f">{header}\n{cleaned}\n")

    # summary object for logs / backend / debugging
    summary = {
        "status": "ok",
        "step": "data_prep",
        "input": str(args.input),
        "outdir": str(args.outdir),
        "format": fmt,
        "min_length": args.min_length,
        "counts": {
            "total_sequences": total,
            "kept_sequences": kept,
            "skipped_short": skipped_short,
        },
        "sample_headers": sample_headers,
        "artifacts": {
            "cleaned_fasta": str(cleaned_fasta),
        },
    }

    # save summary to json file
    write_json(result_json, summary)

    # also print summary so other tools/logs can read it
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()