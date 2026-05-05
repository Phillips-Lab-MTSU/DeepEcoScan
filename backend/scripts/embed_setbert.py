#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np


# writes a python dictionary to a json file
def write_json(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")


# reads a fasta file and returns one sequence at a time
# each item is returned as: (header, sequence)
def parse_fasta(path: Path):
    header = None
    seq_chunks = []

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()

            # skip blank lines
            if not line:
                continue

            # a new fasta header means the last sequence is complete
            if line.startswith(">"):
                if header is not None:
                    yield header, "".join(seq_chunks)

                # store the new header without the > symbol
                header = line[1:].strip()
                seq_chunks = []
            else:
                # keep building the sequence until the next header
                seq_chunks.append(line)

        # return the last sequence after the loop ends
        if header is not None:
            yield header, "".join(seq_chunks)


# builds a fake embedding vector from simple sequence features
# this is being used for testing until the real setbert path is added
def build_dummy_embedding(seq: str, dim: int = 16) -> list[float]:
    # basic sequence stats
    length = len(seq)
    a = seq.count("A")
    c = seq.count("C")
    g = seq.count("G")
    t = seq.count("T")
    n = seq.count("N")

    # build a 16-value numeric vector using counts, ratios, and remainders
    base_vec = np.array([
        length,
        a,
        c,
        g,
        t,
        n,
        a / length if length else 0,
        c / length if length else 0,
        g / length if length else 0,
        t / length if length else 0,
        n / length if length else 0,
        (a + t) / length if length else 0,
        (c + g) / length if length else 0,
        length % 10,
        length % 25,
        length % 50,
    ], dtype=float)

    # convert numpy array to normal python list for json output
    return base_vec.tolist()


def main() -> None:
    # command line argument setup
    parser = argparse.ArgumentParser(
        description="Generate sample embeddings from prep outputs."
    )

    # directory that contains prep results
    parser.add_argument(
        "--prep-dir",
        required=True,
        type=Path,
        help="Prep output directory"
    )

    # directory where embedding output will be written
    parser.add_argument(
        "--outdir",
        required=True,
        type=Path,
        help="Embedding output directory"
    )

    # device choice for future real embedding support
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda", "mps"])

    # run in dummy mode for now
    parser.add_argument("--dummy", action="store_true", help="Run dummy embedding mode")

    # allows overwriting output files
    parser.add_argument("--force", action="store_true")

    args = parser.parse_args()

    # create output directory if needed
    args.outdir.mkdir(parents=True, exist_ok=True)

    # expected input and output files
    cleaned_fasta = args.prep_dir / "sequences.fasta.cleaned"
    output_json = args.outdir / "embedding_output.json"
    result_json = args.outdir / "result.json"

    # make sure prep output exists before continuing
    if not cleaned_fasta.exists():
        raise FileNotFoundError(f"Prep artifact not found: {cleaned_fasta}")

    # prevent overwrite unless --force is given
    if output_json.exists() and not args.force:
        raise FileExistsError(
            f"Refusing to overwrite existing file: {output_json} (pass --force)"
        )

    if result_json.exists() and not args.force:
        raise FileExistsError(
            f"Refusing to overwrite existing file: {result_json} (pass --force)"
        )

    # store all embedding results here
    embeddings = []

    # read each cleaned sequence from fasta file
    for header, seq in parse_fasta(cleaned_fasta):
        # for now only dummy mode works
        if args.dummy:
            vector = build_dummy_embedding(seq)
        else:
            raise NotImplementedError(
                "Real SetBERT embedding path not wired yet. Use --dummy for now."
            )

        # save one embedding record per sequence
        embeddings.append({
            "id": header,
            "sequence_length": len(seq),
            "embedding": vector,
        })

    # write the full embedding output file
    write_json(output_json, {
        "status": "ok",
        "mode": "dummy" if args.dummy else "real",
        "device": args.device,
        "count": len(embeddings),
        "embeddings": embeddings,
    })

    # create a smaller summary file for logging / backend status
    summary = {
        "status": "ok",
        "step": "embedding",
        "prep_dir": str(args.prep_dir),
        "outdir": str(args.outdir),
        "device": args.device,
        "dummy": args.dummy,
        "counts": {
            "embedded_sequences": len(embeddings),
            "embedding_dim": 16 if embeddings else 0,
        },
        "artifacts": {
            "embedding_output": str(output_json),
        },
    }

    # write summary file
    write_json(result_json, summary)

    # also print summary to terminal/logs
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()