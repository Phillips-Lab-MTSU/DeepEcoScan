#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np


def write_json(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")


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


def build_dummy_embedding(seq: str, dim: int = 16) -> list[float]:
    length = len(seq)
    a = seq.count("A")
    c = seq.count("C")
    g = seq.count("G")
    t = seq.count("T")
    n = seq.count("N")

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

    return base_vec.tolist()


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate sample embeddings from prep outputs.")
    parser.add_argument("--prep-dir", required=True, type=Path, help="Prep output directory")
    parser.add_argument("--outdir", required=True, type=Path, help="Embedding output directory")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda", "mps"])
    parser.add_argument("--dummy", action="store_true", help="Run dummy embedding mode")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    args.outdir.mkdir(parents=True, exist_ok=True)

    cleaned_fasta = args.prep_dir / "sequences.fasta.cleaned"
    output_json = args.outdir / "embedding_output.json"
    result_json = args.outdir / "result.json"

    if not cleaned_fasta.exists():
        raise FileNotFoundError(f"Prep artifact not found: {cleaned_fasta}")

    if output_json.exists() and not args.force:
        raise FileExistsError(f"Refusing to overwrite existing file: {output_json} (pass --force)")
    if result_json.exists() and not args.force:
        raise FileExistsError(f"Refusing to overwrite existing file: {result_json} (pass --force)")

    embeddings = []
    for header, seq in parse_fasta(cleaned_fasta):
        if args.dummy:
            vector = build_dummy_embedding(seq)
        else:
            raise NotImplementedError("Real SetBERT embedding path not wired yet. Use --dummy for now.")

        embeddings.append({
            "id": header,
            "sequence_length": len(seq),
            "embedding": vector,
        })

    write_json(output_json, {
        "status": "ok",
        "mode": "dummy" if args.dummy else "real",
        "device": args.device,
        "count": len(embeddings),
        "embeddings": embeddings,
    })

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

    write_json(result_json, summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()