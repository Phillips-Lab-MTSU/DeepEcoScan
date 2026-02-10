#!/bin/bash
# Use bash explicitly (common for Slurm job scripts)

# -----------------------------
# Slurm job directives (handled by Slurm *before* the script runs)
# -----------------------------
#SBATCH -p research                      # Submit to the "research" partition/queue
#SBATCH -G 1                             # Request 1 GPU (so CUDA can be used)
#SBATCH --job-name=deepecoscan-setbert   # Human-friendly job name in squeue/sacct
#SBATCH --output=logs/deepecoscan-%j.out # Stdout log file (%j = Slurm job ID)
#SBATCH --error=logs/deepecoscan-%j.err  # Stderr log file (%j = Slurm job ID)

# Fail fast:
#  - stop on error (-e)
#  - error on unset variables (-u)
#  - pipeline fails if any command in it fails (pipefail)
set -euo pipefail

# Quick sanity check: proves the job really got a GPU + shows driver/CUDA info in logs
nvidia-smi

# --------------------------------------------------
# Paths
# --------------------------------------------------

# Project directory containing your scripts (run_prep_and_embed.sh, data_prep.py, embed_setbert.py, etc.)
PROJ_DIR="/projects/hb4e/setBertButPyScripts"

# Raw input data (source) stored in home/projects (persistent)
# This is the "truth" dataset that we copy *from* at the start of each job.
SRC_DATA="/home/hb4e/hbastian/setbert/notebooks/sfd-tutorial/data"

# Scratch space (fast, temporary, not guaranteed to persist long-term)
# BASE_SCRATCH is a user-level folder; JOB_SCRATCH is job-specific, using the Slurm job ID.
BASE_SCRATCH="/scratch/hb4e/sfd16s"
JOB_SCRATCH="${BASE_SCRATCH}/${SLURM_JOB_ID}"

# Where this job will place its staged inputs and outputs on scratch
INPUT_DIR="${JOB_SCRATCH}/input"
WORK_DIR="${JOB_SCRATCH}/run"

# Persistent output location (safe place to keep results after job ends)
RESULTS_BASE="${PROJ_DIR}/testruns"
RESULTS_DIR="${RESULTS_BASE}/job_${SLURM_JOB_ID}"

# --------------------------------------------------
# Stage input data to scratch
# --------------------------------------------------
# Why stage to scratch?
# - scratch is usually MUCH faster than home/project storage
# - reduces load on shared home filesystem during heavy reads
# - isolates each job's inputs/outputs (no collisions between runs)
echo "Staging input data to scratch..."
mkdir -p "${INPUT_DIR}"

# rsync copies the dataset into scratch while preserving structure/metadata
# trailing slashes mean: copy *contents of SRC_DATA* into INPUT_DIR
rsync -av "${SRC_DATA}/" "${INPUT_DIR}/"

# --------------------------------------------------
# Run pipeline inside Apptainer
# --------------------------------------------------
# We use srun so the container runs under Slurm's allocation (GPU/CPU/mem)
# apptainer exec runs commands inside the container image (.sif)
srun apptainer exec --nv \
  # --nv exposes the host GPU drivers/devices inside the container (required for CUDA)
  --bind /scratch:/scratch \
  # Bind host /scratch into the container at the same path so INPUT_DIR/WORK_DIR exist in-container

  --bind "${PROJ_DIR}:${PROJ_DIR}" \
  # Bind the project directory into the container so the scripts are available at the same path

  --bind "/home/hb4e:/home/hb4e" \
  # Bind your home directory so any referenced files/configs are accessible (and paths match)

  /home/shared/sif/csci-2025-Fall.sif \
  # The actual container image used for the run (defines Python, PyTorch, SetBERT deps, etc.)

  bash -lc "
    # Start a login shell (-l) and run the following commands (-c)
    # Doing this inside a quoted string keeps the whole command as one container invocation.
    set -euo pipefail

    # Move into the project folder inside the container (same path as on the host due to bind)
    cd '${PROJ_DIR}'

    # Ensure the pipeline runner script is executable (safe even if already executable)
    chmod +x run_prep_and_embed.sh

    # Run the two-step pipeline:
    #   1) data_prep.py   -> creates DNADB artifacts under WORK_DIR/dnadb
    #   2) embed_setbert.py -> creates embeddings under WORK_DIR/embeddings
    #
    # INPUT_DIR points at the staged scratch copy of the raw dataset.
    # WORK_DIR is also on scratch for fast temporary computation.
    ./run_prep_and_embed.sh \
      --input-dir '${INPUT_DIR}' \
      --work-dir  '${WORK_DIR}' \
      --device cuda
  "

# --------------------------------------------------
# Copy results back to project storage
# --------------------------------------------------
# After the computation finishes, copy outputs off scratch to a persistent location.
# This protects results from scratch cleanup and makes them easy to find later.
echo "Copying results back to ${RESULTS_DIR}..."
mkdir -p "${RESULTS_DIR}"

# Copy the entire run directory (dnadb outputs + embeddings + JSON summaries, etc.)
rsync -av "${WORK_DIR}/" "${RESULTS_DIR}/"

echo "Results copied to: ${RESULTS_DIR}"
