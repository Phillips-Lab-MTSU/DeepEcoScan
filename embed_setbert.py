#!/usr/bin/env python3

# Run with the user's default python3 interpreter (works nicely with venvs/containers)
from __future__ import annotations
# Allows forward-references in type hints (useful for modern typing + older runtimes)

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
    """
    Move a tensor to the requested compute backend.

    device choices:
      - "cuda": NVIDIA GPU (fastest if available)
      - "mps": Apple Silicon GPU via Metal (Mac)
      - "cpu": fallback (slowest, but always works)

    Note: This function only moves *tensors*. The model is moved separately.
    """
    if device == "cuda":
        return x.cuda()
    if device == "mps":
        return x.to("mps")
    return x.cpu()


def load_model(model_id: str, revision: str, device: str, chunk_size: int) -> SetBertForSampleEmbedding:
    """
    Load a pretrained SetBERT model and configure it for inference.

    - from_pretrained(model_id, revision=...) loads weights/config from a model hub
    - eval() disables training-only behaviors like dropout
    - sequence_encoder_chunk_size controls how sequences are processed in chunks
      (smaller chunks -> less memory, potentially slower)
    """
    model = SetBertForSampleEmbedding.from_pretrained(model_id, revision=revision)
    model.eval()

    # Controls internal batching/chunking while encoding sequences.
    # This is mainly a memory/performance knob.
    model.config.sequence_encoder_chunk_size = chunk_size

    # Move the model to the same compute backend we plan to use for tensors.
    if device == "cuda":
        model = model.cuda()
    elif device == "mps":
        model = model.to("mps")
    else:
        model = model.cpu()

    return model


def collate(model: SetBertForSampleEmbedding, seq_entries: list[fasta.FastaEntry]) -> torch.Tensor:
    """
    Convert a list of FASTA entries into a padded token ID tensor.

    SetBERT expects tokenized sequences, but sequences can have different lengths.
    We tokenize each sequence, then pad them all to the same max length so they can
    be stacked into a single tensor.

    Output shape:
      (N, L)
      - N = number of sequences sampled for this sample
      - L = max tokenized sequence length in this batch
    """
    # Tokenize each sequence string into a 1D tensor of token IDs.
    token_ids = [torch.tensor(model.sequence_encoder.tokenizer(e.sequence)) for e in seq_entries]

    # Find the longest sequence so we know how much padding is required.
    max_length = max(len(s) for s in token_ids)

    # Pad each sequence on the right with zeros to match max_length.
    # (Assumes tokenizer uses 0 as pad id; that’s typical, but depends on the model.)
    token_ids = [F.pad(s, (0, max_length - len(s))) for s in token_ids]

    # Stack into a single 2D tensor: (N, L)
    return torch.stack(token_ids)  # (N, L)


def embed_one_sample(model: SetBertForSampleEmbedding, token_ids: torch.Tensor, device: str) -> np.ndarray:
    """
    Run SetBERT inference to produce one embedding vector for a single "sample".

    token_ids shape: (N, L) where N sequences represent a single sample.
    The model call expects a batch dimension for "samples", so we add one:
      x.unsqueeze(0) -> (1, N, L)

    Output:
      A single embedding vector of shape (D,), returned as a NumPy array.
    """
    # Inference-only mode: disables gradient tracking to reduce memory + speed up.
    with torch.no_grad():
        # Move token tensor to same backend as the model.
        x = move_to_device(token_ids, device=device)       # (N, L)

        # SetBERT is a "set" model: it embeds a set of sequences into one vector.
        # Add batch dimension: (1, N, L) -> output (1, D) then squeeze to (D,)
        y = model(x.unsqueeze(0)).squeeze()                # (D,)

        # Ensure the output is moved back to CPU and converted into NumPy.
        return y.detach().cpu().numpy()


def main() -> None:
    """
    CLI entry point.

    This script:
      1) Loads DNADB sequence + mapping databases produced by the prep step
      2) For each sample in the mapping DB:
           - randomly samples `sample_size` sequences from that sample
           - tokenizes + pads them
           - runs SetBERT to get one embedding vector for that sample
      3) Saves all sample embeddings to a pickle file + writes a JSON summary
    """
    p = argparse.ArgumentParser(description="Generate SetBERT sample embeddings from DNADB outputs.")
    p.add_argument("--dnadb-dir", required=True, type=Path, help="Folder containing sequences.fasta.db + sequences.mapping.fasta.db")
    p.add_argument("--outdir", required=True, type=Path)

    # Model selection + runtime knobs
    p.add_argument("--model-id", default="sirdavidludwig/setbert")
    p.add_argument("--revision", default="qiita-16s")
    p.add_argument("--device", default="cuda", choices=["cpu", "cuda", "mps"])
    p.add_argument("--chunk-size", type=int, default=128)

    # Sampling controls:
    #   Each "sample embedding" is built from a random set of sequences for that sample.
    #   Using a fixed seed makes results reproducible.
    p.add_argument("--sample-size", type=int, default=1000, help="Sequences sampled per sample (matches notebook)")
    p.add_argument("--seed", type=int, default=0)

    args = p.parse_args()

    # Ensure output directory exists before writing anything.
    args.outdir.mkdir(parents=True, exist_ok=True)

    # Load the sequence DB and mapping DB produced by your earlier pipeline step.
    seq_db = fasta.FastaDb(str(args.dnadb_dir / "sequences.fasta.db"))
    mappings = seq_db.mappings(str(args.dnadb_dir / "sequences.mapping.fasta.db"))

    # Load SetBERT model and initialize RNG for reproducible sampling.
    model = load_model(args.model_id, args.revision, args.device, args.chunk_size)
    rng = np.random.default_rng(args.seed)

    # Collect embeddings as: sample_name -> embedding_vector (NumPy array)
    embeddings: dict[str, np.ndarray] = {}

    # Iterate through each sample mapping and generate its embedding.
    for mapping in tqdm(mappings, desc="Embedding samples"):
        name = mapping.name

        # Draw a set of sequences from this sample.
        # The sampling logic lives inside DNADB's mapping object.
        seq_entries = mapping.sample(args.sample_size, rng)

        # Convert sequences to padded token IDs: (N, L)
        token_ids = collate(model, seq_entries)

        # Run SetBERT to get a single vector: (D,)
        embeddings[name] = embed_one_sample(model, token_ids, device=args.device)

    # Persist embeddings to disk for downstream use.
    # Pickle is convenient for Python pipelines (not human-readable).
    pkl_path = args.outdir / "sfd_embeddings.pkl"
    with open(pkl_path, "wb") as f:
        pickle.dump(embeddings, f)

    # Quick summary: infer embedding dimensionality from any one vector.
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

    # Write a machine-readable run log so results are traceable/reproducible.
    (args.outdir / "result.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    # Print the same summary for quick terminal feedback.
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    # Standard Python pattern: only execute main() when run directly.
    main()
