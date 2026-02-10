#!/bin/bash
#SBATCH -p research
#SBATCH -G 1
#SBATCH --job-name=deepecoscan-setbert
#SBATCH --output=logs/deepecoscan-%j.out
#SBATCH --error=logs/deepecoscan-%j.err
set -euo pipefail

nvidia-smi

# --------------------------------------------------
# Paths
# --------------------------------------------------
PROJ_DIR="/projects/hb4e/setBertButPyScripts"

# Raw input data (source)
SRC_DATA="/home/hb4e/hbastian/setbert/notebooks/sfd-tutorial/data"

# Scratch (job-scoped)
BASE_SCRATCH="/scratch/hb4e/sfd16s"
JOB_SCRATCH="${BASE_SCRATCH}/${SLURM_JOB_ID}"

INPUT_DIR="${JOB_SCRATCH}/input"
WORK_DIR="${JOB_SCRATCH}/run"

# Persistent output location
RESULTS_BASE="${PROJ_DIR}/testruns"
RESULTS_DIR="${RESULTS_BASE}/job_${SLURM_JOB_ID}"

# --------------------------------------------------
# Stage input data to scratch
# --------------------------------------------------
echo "Staging input data to scratch..."
mkdir -p "${INPUT_DIR}"
rsync -av "${SRC_DATA}/" "${INPUT_DIR}/"

# --------------------------------------------------
# Run pipeline inside Apptainer
# --------------------------------------------------
srun apptainer exec --nv \
  --bind /scratch:/scratch \
  --bind "${PROJ_DIR}:${PROJ_DIR}" \
  --bind "/home/hb4e:/home/hb4e" \
  /home/shared/sif/csci-2025-Fall.sif \
  bash -lc "
    set -euo pipefail
    cd '${PROJ_DIR}'
    chmod +x run_prep_and_embed.sh

    ./run_prep_and_embed.sh \
      --input-dir '${INPUT_DIR}' \
      --work-dir  '${WORK_DIR}' \
      --device cuda
  "

# --------------------------------------------------
# Copy results back to project storage
echo "Copying results back to ${RESULTS_DIR}..."
mkdir -p "${RESULTS_DIR}"
rsync -av "${WORK_DIR}/" "${RESULTS_DIR}/"

echo "Results copied to: ${RESULTS_DIR}"

