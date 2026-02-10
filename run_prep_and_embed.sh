#!/usr/bin/env bash
# Use env to locate bash (portable across systems)

# Exit immediately if:
#  - any command fails (-e)
#  - any variable is used before being set (-u)
#  - any command in a pipeline fails (-o pipefail)
# This makes the script fail fast and prevents silent errors.
set -euo pipefail

# ---------------------------------------------
# DeepEcoScan pipeline runner (2-step)
#   1) data_prep.py       -> builds DNADB artifacts
#   2) embed_setbert.py   -> generates SetBERT embeddings
#
# Assumes this .sh file lives in the same directory
# as data_prep.py and embed_setbert.py
# ---------------------------------------------

# Print usage/help text and exit
usage() {
  cat <<'EOF'
Usage:
  ./run_prep_and_embed.sh --input-dir <path> --work-dir <path> [options]

Required:
  --input-dir PATH     Directory containing raw input files (FASTA, .asv.list, .asv.shared, metadata.csv, taxonomy.tsv)
  --work-dir PATH      Base output directory (creates dnadb/ and embeddings/ inside it)

Options (Data Prep):
  --min-length N       Minimum sequence length (default: 150)
  --force              Overwrite existing outputs for data prep (passed to data_prep.py)

Options (Embedding):
  --device DEV         cpu|cuda|mps (default: cuda)
  --model-id ID        (default: sirdavidludwig/setbert)
  --revision REV       (default: qiita-16s)
  --chunk-size N       (default: 128)
  --sample-size N      (default: 1000)
  --seed N             (default: 0)

Environment:
  PYTHON_BIN           Python executable to use (default: python3)

Examples:
  ./run_prep_and_embed.sh --input-dir sfd-tutorial/data --work-dir sfd-tutorial/run1 --device cuda
  ./run_prep_and_embed.sh --input-dir sfd-tutorial/data --work-dir sfd-tutorial/run1 --force
EOF
}

# -------------------------
# Default parameter values
# -------------------------
MIN_LENGTH=150
DEVICE="cuda"
MODEL_ID="sirdavidludwig/setbert"
REVISION="qiita-16s"
CHUNK_SIZE=128
SAMPLE_SIZE=1000
SEED=0
FORCE=0

# Required arguments (initialized empty and validated later)
INPUT_DIR=""
WORK_DIR=""

# -------------------------
# Argument parsing loop
# -------------------------
# Walk through all CLI arguments and assign values based on flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --input-dir) INPUT_DIR="${2:-}"; shift 2 ;;
    --work-dir) WORK_DIR="${2:-}"; shift 2 ;;

    --min-length) MIN_LENGTH="${2:-}"; shift 2 ;;
    --device) DEVICE="${2:-}"; shift 2 ;;
    --model-id) MODEL_ID="${2:-}"; shift 2 ;;
    --revision) REVISION="${2:-}"; shift 2 ;;
    --chunk-size) CHUNK_SIZE="${2:-}"; shift 2 ;;
    --sample-size) SAMPLE_SIZE="${2:-}"; shift 2 ;;
    --seed) SEED="${2:-}"; shift 2 ;;
    --force) FORCE=1; shift 1 ;;

    # Help flag
    -h|--help) usage; exit 0 ;;

    # Catch-all for unknown flags
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

# Validate required arguments
if [[ -z "$INPUT_DIR" || -z "$WORK_DIR" ]]; then
  echo "Error: --input-dir and --work-dir are required." >&2
  usage
  exit 1
fi

# -------------------------
# Resolve paths and tools
# -------------------------

# Absolute path to the directory containing this script
# This allows the script to be run from *any* working directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Python executable to use (can be overridden via env var)
PYTHON_BIN="${PYTHON_BIN:-python3}"

# Output subdirectories
DNADB_DIR="${WORK_DIR}/dnadb"
EMBED_DIR="${WORK_DIR}/embeddings"

# Create output directories if they do not already exist
mkdir -p "$DNADB_DIR" "$EMBED_DIR"

# Build optional --force flag array (bash-safe way to conditionally add flags)
FORCE_FLAG=()
if [[ "$FORCE" -eq 1 ]]; then
  FORCE_FLAG=(--force)
fi

# -------------------------
# Print run configuration
# -------------------------
echo "== Settings =="
echo "INPUT_DIR:   $INPUT_DIR"
echo "WORK_DIR:    $WORK_DIR"
echo "DNADB_DIR:   $DNADB_DIR"
echo "EMBED_DIR:   $EMBED_DIR"
echo "MIN_LENGTH:  $MIN_LENGTH"
echo "DEVICE:      $DEVICE"
echo "MODEL_ID:    $MODEL_ID"
echo "REVISION:    $REVISION"
echo "CHUNK_SIZE:  $CHUNK_SIZE"
echo "SAMPLE_SIZE: $SAMPLE_SIZE"
echo "SEED:        $SEED"
echo "FORCE:       $FORCE"
echo

# -------------------------
# Step 1: Data preparation
# -------------------------
# Builds:
#   - sequences.fasta.db
#   - sequences.mapping.fasta.db
#   - metadata.csv
#   - taxonomy.tsv
echo "== 1) Data Prep =="
"$PYTHON_BIN" "${SCRIPT_DIR}/data_prep.py" \
  --input-dir "$INPUT_DIR" \
  --outdir "$DNADB_DIR" \
  --min-length "$MIN_LENGTH" \
  "${FORCE_FLAG[@]}"

echo

# -------------------------
# Step 2: Embedding
# -------------------------
# Uses SetBERT to generate one embedding per sample
# Output is saved as a pickle file
echo "== 2) Embedding (SetBERT) =="
"$PYTHON_BIN" "${SCRIPT_DIR}/embed_setbert.py" \
  --dnadb-dir "$DNADB_DIR" \
  --outdir "$EMBED_DIR" \
  --model-id "$MODEL_ID" \
  --revision "$REVISION" \
  --device "$DEVICE" \
  --chunk-size "$CHUNK_SIZE" \
  --sample-size "$SAMPLE_SIZE" \
  --seed "$SEED"

# -------------------------
# Final output locations
# -------------------------
echo
echo "DNADB outputs:  $DNADB_DIR"
echo "Embeddings:     ${EMBED_DIR}/sfd_embeddings.pkl"
