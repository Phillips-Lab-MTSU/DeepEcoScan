#!/usr/bin/env python3

# how to runpython run_setbert_embeddings.py \
#   --dnadb-dir sfd-tutorial/dnadb \
#   --outdir sfd-tutorial/embeddings \
#   --device cuda

from __future__ import annotations

import argparse
import json
import pickle
import sys
from pathlib import Path

import numpy as np
from tqdm import tqdm

from setbert_common import ModelSpec, load_dnadb, load_model, collate_dna_sequences, embed_one_sample


def run(
    dnadb_dir: Path,
    outdir: Path,
    model_id: str,
    revision: str,
    device: str,
    chunk_size: int,
    sample_size: int,
    seed: int,
) -> dict:
    outdir.mkdir(parents=True, exist_ok=True)

    sequences_db, mappings = load_dnadb(dnadb_dir)
    model = load_model(ModelSpec(model_id=model_id, revision=revision, device=device, chunk_size=chunk_size))

    rng = np.random.default_rng(seed)

    embeddings: dict[str, np.ndarray] = {}

    for mapping in tqdm(mappings, desc="Embedding samples"):
        name = mapping.name

        # Exactly like notebook: mapping.sample(1000, rng)
        seq_entries = mapping.sample(sample_size, rng)

        # Tokenize + pad (N, L)
        token_ids = collate_dna_sequences(model, seq_entries)

        # Run model -> (D,)
        embeddings[name] = embed_one_sample(model, token_ids, device=device)

    # Save embeddings (pickle only)
    pkl_path = outdir / "sfd_embeddings.pkl"
    with open(pkl_path, "wb") as f:
        pickle.dump(embeddings, f)

    summary = {
        "status": "ok",
        "dnadb_dir": str(dnadb_dir),
        "outdir": str(outdir),
        "model": {"id": model_id, "revision": revision},
        "device": device,
        "chunk_size": chunk_size,
        "sample_size": sample_size,
        "seed": seed,
        "counts": {
            "num_samples": len(embeddings),
            "embedding_dim": next(iter(embeddings.values())).shape[0],
        },
        "artifacts": {
            "pickle": str(pkl_path),
        },
    }
    (outdir / "result.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Generate SetBERT sample embeddings from DNADB outputs.")
    p.add_argument("--dnadb-dir", required=True, type=Path, help="Folder containing sequences.fasta.db and sequences.mapping.fasta.db")
    p.add_argument("--outdir", required=True, type=Path)

    p.add_argument("--model-id", default="sirdavidludwig/setbert")
    p.add_argument("--revision", default="qiita-16s")
    p.add_argument("--device", default="cuda", choices=["cpu", "cuda", "mps"])
    p.add_argument("--chunk-size", type=int, default=128)

    p.add_argument("--sample-size", type=int, default=1000, help="Number of sequences to sample per sample (matches notebook)")
    p.add_argument("--seed", type=int, default=0)

    args = p.parse_args(argv)

    summary = run(
        dnadb_dir=args.dnadb_dir,
        outdir=args.outdir,
        model_id=args.model_id,
        revision=args.revision,
        device=args.device,
        chunk_size=args.chunk_size,
        sample_size=args.sample_size,
        seed=args.seed,
    )

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
