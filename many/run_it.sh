#!/bin/bash
#SBATCH -p research
#SBATCH -G 1
#SBATCH --job-name=deepecoscan-setbert
#SBATCH --output=logs/deepecoscan-%j.out
#SBATCH --error=logs/deepecoscan-%j.err
set -euo pipefail
# ----------------------------
nvidia-smi
# ----------------------------
PROJ_DIR="/projects/hb4e/setBertButPyScripts"
# Scratch path 
BASE_SCRATCH="/scratch/hb4e/sfd16s"
INPUT_DIR="${BASE_SCRATCH}"
WORK_DIR="${BASE_SCRATCH}"
# Run DeepEcoScan pipeline
srun apptainer exec --nv \
  --bind /scratch:/scratch \
  --bind "${PROJ_DIR}:${PROJ_DIR}" \
  /home/shared/sif/csci-2025-Fall.sif \
  bash -lc "cd '${PROJ_DIR}' && python3 run_pipeline.py \
    --input-dir '${INPUT_DIR}' \
    --work-dir  '${WORK_DIR}' \
    --device cuda"
~                                         