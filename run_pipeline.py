#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def run_cmd(cmd: list[str], cwd: Path | None = None) -> None:
    """Run a command, stream output live, and fail fast on errors."""
    print("\n$ " + " ".join(cmd))
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(
        description="Run DeepEcoScan SFD 16S pipeline scripts in order."
    )
    p.add_argument("--input-dir", required=True, type=Path, help="Folder containing raw SFD tutorial files")
    p.add_argument("--work-dir", required=True, type=Path, help="Base output folder for all pipeline artifacts")

    # Data prep options
    p.add_argument("--min-length", type=int, default=150)

    # SetBERT options
    p.add_argument("--device", choices=["cpu", "cuda", "mps"], default="cuda")
    p.add_argument("--model-id", default="sirdavidludwig/setbert")
    p.add_argument("--revision", default="qiita-16s")
    p.add_argument("--chunk-size", type=int, default=128)
    p.add_argument("--sample-size", type=int, default=1000)
    p.add_argument("--seed", type=int, default=0)

    # Projection options
    p.add_argument("--jobs", type=int, default=8)
    p.add_argument("--tsne-perplexity", type=float, default=30.0)

    # Safety/overwrite
    p.add_argument("--force", action="store_true", help="Overwrite existing outputs in each stage")

    args = p.parse_args(argv)

    # Resolve script directory (assumes scripts are alongside this file)
    script_dir = Path(__file__).resolve().parent

    # Stage output dirs
    dnadb_dir = args.work_dir / "dnadb"
    embed_dir = args.work_dir / "embeddings"

    # Ensure base folders exist (safe)
    dnadb_dir.mkdir(parents=True, exist_ok=True)
    embed_dir.mkdir(parents=True, exist_ok=True)

    try:
        # 1) Build FASTA DB
        cmd1 = [
            sys.executable,
            str(script_dir / "build_fasta_db.py"),
            "--input-dir", str(args.input_dir),
            "--outdir", str(dnadb_dir),
            "--min-length", str(args.min_length),
        ]
        if args.force:
            cmd1.append("--force")
        run_cmd(cmd1)

        # 2) Build Mapping DB (+ copy metadata/taxonomy)
        cmd2 = [
            sys.executable,
            str(script_dir / "build_mapping_db.py"),
            "--input-dir", str(args.input_dir),
            "--outdir", str(dnadb_dir),
        ]
        if args.force:
            cmd2.append("--force")
        run_cmd(cmd2)

        # 3) Run SetBERT sample embeddings (pickle output)
        cmd3 = [
            sys.executable,
            str(script_dir / "run_setbert_embeddings.py"),
            "--dnadb-dir", str(dnadb_dir),
            "--outdir", str(embed_dir),
            "--model-id", args.model_id,
            "--revision", args.revision,
            "--device", args.device,
            "--chunk-size", str(args.chunk_size),
            "--sample-size", str(args.sample_size),
            "--seed", str(args.seed),
        ]
        run_cmd(cmd3)

        # 4) Project embeddings to 2D (from pickle)
        pkl_path = embed_dir / "sfd_embeddings.pkl"
        out_csv = embed_dir / "sample_embeddings_2d.csv"

        cmd4 = [
            sys.executable,
            str(script_dir / "project_embeddings_2d.py"),
            "--pickle", str(pkl_path),
            "--out", str(out_csv),
            "--jobs", str(args.jobs),
            "--seed", str(args.seed),
            "--tsne-perplexity", str(args.tsne_perplexity),
        ]
        run_cmd(cmd4)

        print("\nPipeline complete.")
        print(f"DNADB outputs:   {dnadb_dir}")
        print(f"Embeddings:      {embed_dir / 'sfd_embeddings.pkl'}")
        print(f"2D projections:  {out_csv}")
        return 0

    except subprocess.CalledProcessError as e:
        print(f"\nPipeline failed (exit code {e.returncode}).", file=sys.stderr)
        return e.returncode


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
