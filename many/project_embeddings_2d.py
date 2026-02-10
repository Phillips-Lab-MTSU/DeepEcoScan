#!/usr/bin/env python3

# run with the following
# python project_embeddings_2d.py \
#   --pickle sfd-tutorial/embeddings/sfd_embeddings.pkl \
#   --out sfd-tutorial/embeddings/sample_embeddings_2d.csv

from __future__ import annotations

import argparse
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.manifold import MDS, TSNE


def load_embeddings_pickle(pkl_path: Path) -> tuple[list[str], np.ndarray]:
    """
    Expects a pickle containing: dict[str, np.ndarray]
      - keys: sample names
      - values: 1D embedding vectors (same length for all samples)
    Returns:
      - names: list[str]
      - X: (N, D) float array
    """
    with open(pkl_path, "rb") as f:
        obj = pickle.load(f)

    if not isinstance(obj, dict) or not obj:
        raise ValueError("Pickle must contain a non-empty dict[name -> embedding_vector].")

    names = list(obj.keys())
    vectors = [obj[name] for name in names]

    # Validate vectors
    first = vectors[0]
    if not isinstance(first, np.ndarray) or first.ndim != 1:
        raise ValueError("Each embedding must be a 1D numpy array.")

    dim = first.shape[0]
    for i, v in enumerate(vectors):
        if not isinstance(v, np.ndarray) or v.ndim != 1:
            raise ValueError(f"Embedding for '{names[i]}' is not a 1D numpy array.")
        if v.shape[0] != dim:
            raise ValueError(
                f"Embedding dim mismatch at '{names[i]}': expected {dim}, got {v.shape[0]}"
            )

    X = np.stack(vectors, axis=0)
    return names, X


def main() -> None:
    p = argparse.ArgumentParser(
        description="Project SetBERT sample embeddings to 2D (MDS + t-SNE) from a pickle file."
    )
    p.add_argument(
        "--pickle",
        required=True,
        type=Path,
        help="Path to embeddings pickle (dict[str, np.ndarray])",
    )
    p.add_argument(
        "--out",
        required=True,
        type=Path,
        help="Output CSV path (will contain mds_x, mds_y, tsne_x, tsne_y)",
    )
    p.add_argument(
        "--jobs",
        type=int,
        default=8,
        help="Parallel jobs for MDS (scikit-learn).",
    )
    p.add_argument(
        "--seed",
        type=int,
        default=0,
        help="Random seed for t-SNE (and anything stochastic).",
    )
    p.add_argument(
        "--tsne-perplexity",
        type=float,
        default=30.0,
        help="t-SNE perplexity. Must be < number of samples.",
    )
    args = p.parse_args()

    names, X = load_embeddings_pickle(args.pickle)

    # Sanity: t-SNE perplexity must be < N
    n = X.shape[0]
    perplexity = args.tsne_perplexity
    if perplexity >= n:
        # keep it valid instead of crashing; use a conservative fallback
        perplexity = max(5.0, min(30.0, n - 1.0))

    # MDS: deterministic-ish depending on solver; keep random_state for consistency
    mds = MDS(
        n_components=2,
        dissimilarity="euclidean",
        n_jobs=args.jobs,
        random_state=args.seed,
    )
    mds_xy = mds.fit_transform(X)

    # t-SNE: stochastic; seed controls reproducibility
    tsne = TSNE(
        n_components=2,
        random_state=args.seed,
        perplexity=perplexity,
        init="pca",
        learning_rate="auto",
    )
    tsne_xy = tsne.fit_transform(X)

    df = pd.DataFrame(
        {
            "name": names,
            "mds_x": mds_xy[:, 0],
            "mds_y": mds_xy[:, 1],
            "tsne_x": tsne_xy[:, 0],
            "tsne_y": tsne_xy[:, 1],
        }
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)


if __name__ == "__main__":
    main()
