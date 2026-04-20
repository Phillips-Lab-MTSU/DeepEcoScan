#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pickle
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from tqdm import tqdm

from dnadb import fasta
from setbert.models import SetBertForSampleEmbedding


def move_to_device(x: torch.Tensor, device: str) -> torch.Tensor:
    if device == "cuda":
        return x.cuda()
    if device == "mps":
        return x.to("mps")
    return x.cpu()


def load_model(model_id: str, revision: str, device: str, chunk_size: int) -> SetBertForSampleEmbedding:
    model = SetBertForSampleEmbedding.from_pretrained(model_id, revision=revision)
    model.eval()
    model.config.sequence_encoder_chunk_size = chunk_size

    if device == "cuda":
        model = model.cuda()
    elif device == "mps":
        model = model.to("mps")
    else:
        model = model.cpu()

    return model


def collate(model: SetBertForSampleEmbedding, seq_entries: list[fasta.FastaEntry]) -> torch.Tensor:
    token_ids = [torch.tensor(model.sequence_encoder.tokenizer(e.sequence)) for e in seq_entries]
    max_length = max(len(s) for s in token_ids)
    token_ids = [F.pad(s, (0, max_length - len(s))) for s in token_ids]
    return torch.stack(token_ids)  # (N, L)


def embed_one_sample(model: SetBertForSampleEmbedding, token_ids: torch.Tensor, device: str) -> np.ndarray:
    with torch.no_grad():
        x = move_to_device(token_ids, device=device)       # (N, L)
        y = model(x.unsqueeze(0)).squeeze()                # (D,)
        return y.detach().cpu().numpy()


def main() -> None:
    p = argparse.ArgumentParser(description="Generate SetBERT sample embeddings from DNADB outputs.")
    p.add_argument("--dnadb-dir", required=True, type=Path, help="Folder containing sequences.fasta.db + sequences.mapping.fasta.db")
    p.add_argument("--outdir", required=True, type=Path)

    p.add_argument("--model-id", default="sirdavidludwig/setbert")
    p.add_argument("--revision", default="qiita-16s")
    p.add_argument("--device", default="cuda", choices=["cpu", "cuda", "mps"])
    p.add_argument("--chunk-size", type=int, default=128)

    p.add_argument("--sample-size", type=int, default=1000, help="Sequences sampled per sample (matches notebook)")
    p.add_argument("--seed", type=int, default=0)

    args = p.parse_args()

    args.outdir.mkdir(parents=True, exist_ok=True)

    seq_db = fasta.FastaDb(str(args.dnadb_dir / "sequences.fasta.db"))
    mappings = seq_db.mappings(str(args.dnadb_dir / "sequences.mapping.fasta.db"))

    model = load_model(args.model_id, args.revision, args.device, args.chunk_size)
    rng = np.random.default_rng(args.seed)

    embeddings: dict[str, np.ndarray] = {}

    for mapping in tqdm(mappings, desc="Embedding samples"):
        name = mapping.name
        seq_entries = mapping.sample(args.sample_size, rng)
        token_ids = collate(model, seq_entries)
        embeddings[name] = embed_one_sample(model, token_ids, device=args.device)

    pkl_path = args.outdir / "sfd_embeddings.pkl"
    with open(pkl_path, "wb") as f:
        pickle.dump(embeddings, f)

    # Quick summary
    any_vec = next(iter(embeddings.values()))
    summary = {
        "status": "ok",
        "dnadb_dir": str(args.dnadb_dir),
        "outdir": str(args.outdir),
        "model": {"id": args.model_id, "revision": args.revision},
        "device": args.device,
        "chunk_size": args.chunk_size,
        "sample_size": args.sample_size,
        "seed": args.seed,
        "counts": {
            "num_samples": len(embeddings),
            "embedding_dim": int(any_vec.shape[0]) if hasattr(any_vec, "shape") else None,
        },
        "artifacts": {"pickle": str(pkl_path)},
    }

    (args.outdir / "result.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
