#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


VALID_BASES = set("ACGTN")


def write_json(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")


def clean_sequence(seq: str) -> str:
    seq = seq.upper()
    return "".join(ch for ch in seq if ch in VALID_BASES)


def parse_fasta(path: Path):
    header = None
    seq_chunks = []

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            if line.startswith(">"):
                if header is not None:
                    yield header, "".join(seq_chunks)
                header = line[1:].strip()
                seq_chunks = []
            else:
                seq_chunks.append(line)

        if header is not None:
            yield header, "".join(seq_chunks)


def parse_fastq(path: Path):
    with path.open("r", encoding="utf-8") as f:
        while True:
            header = f.readline()
            if not header:
                break
            seq = f.readline()
            plus = f.readline()
            qual = f.readline()

            if not seq or not plus or not qual:
                break

            header = header.strip()
            seq = seq.strip()

            if header.startswith("@"):
                yield header[1:].strip(), seq


def detect_format(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in [".fasta", ".fa", ".fna"]:
        return "fasta"
    if ext in [".fastq", ".fq"]:
        return "fastq"
    raise ValueError(f"Unsupported input format: {ext}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare uploaded sequence file for DeepEcoScan pipeline.")
    parser.add_argument("--input", required=True, type=Path, help="Uploaded FASTA/FASTQ file")
    parser.add_argument("--outdir", required=True, type=Path, help="Prep output directory")
    parser.add_argument("--min-length", type=int, default=150)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    args.outdir.mkdir(parents=True, exist_ok=True)

    cleaned_fasta = args.outdir / "sequences.fasta.cleaned"
    result_json = args.outdir / "prep_result.json"

    if cleaned_fasta.exists() and not args.force:
        raise FileExistsError(f"Refusing to overwrite existing file: {cleaned_fasta} (pass --force)")
    if result_json.exists() and not args.force:
        raise FileExistsError(f"Refusing to overwrite existing file: {result_json} (pass --force)")

    fmt = detect_format(args.input)
    parser_fn = parse_fasta if fmt == "fasta" else parse_fastq

    total = 0
    kept = 0
    skipped_short = 0
    sample_headers = []

    with cleaned_fasta.open("w", encoding="utf-8") as out:
        for header, seq in parser_fn(args.input):
            total += 1
            cleaned = clean_sequence(seq)

            if len(cleaned) < args.min_length:
                skipped_short += 1
                continue

            kept += 1
            if len(sample_headers) < 5:
                sample_headers.append(header)

            out.write(f">{header}\n{cleaned}\n")

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

    write_json(result_json, summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()