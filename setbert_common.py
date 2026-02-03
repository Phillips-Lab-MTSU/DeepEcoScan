from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn.functional as F
from dnadb import fasta
from setbert.models import SetBertForSampleEmbedding


@dataclass
class ModelSpec:
    model_id: str = "sirdavidludwig/setbert"
    revision: str = "qiita-16s"
    device: str = "cuda"  # "cpu", "cuda", "mps"
    chunk_size: int = 128


def load_dnadb(dnadb_dir: Path) -> Tuple[fasta.FastaDb, object]:
    """
    Loads:
      - sequences.fasta.db
      - sequences.mapping.fasta.db (via sequences.mappings)
    """
    seq_db = fasta.FastaDb(str(dnadb_dir / "sequences.fasta.db"))
    mappings = seq_db.mappings(str(dnadb_dir / "sequences.mapping.fasta.db"))
    return seq_db, mappings


def load_model(spec: ModelSpec) -> SetBertForSampleEmbedding:
    model = SetBertForSampleEmbedding.from_pretrained(spec.model_id, revision=spec.revision)
    model = model.eval()

    # chunk size used by the sequence encoder inside SetBERT
    model.config.sequence_encoder_chunk_size = spec.chunk_size

    # move model to device
    if spec.device == "cuda":
        model = model.cuda()
    elif spec.device == "mps":
        model = model.to("mps")
    else:
        model = model.cpu()

    return model


def collate_dna_sequences(model: SetBertForSampleEmbedding, seq_entries: List[fasta.FastaEntry]) -> torch.Tensor:
    """
    Matches your notebook collate():
      - tokenizer over each sequence string
      - pad to max length
      - stack -> (N, L)
    """
    token_ids = [torch.tensor(model.sequence_encoder.tokenizer(e.sequence)) for e in seq_entries]
    max_length = max(len(s) for s in token_ids)
    token_ids = [F.pad(s, (0, max_length - len(s))) for s in token_ids]
    return torch.stack(token_ids)


def move_to_device(x: torch.Tensor, device: str) -> torch.Tensor:
    if device == "cuda":
        return x.cuda()
    if device == "mps":
        return x.to("mps")
    return x.cpu()


def embed_one_sample(
    model: SetBertForSampleEmbedding,
    token_ids: torch.Tensor,
    device: str,
) -> np.ndarray:
    """
    Your notebook calls:
      model(sequences.unsqueeze(0).cuda()).squeeze().cpu().numpy()
    where sequences is (N, L).

    So we do:
      input -> (1, N, L)
      output -> (D,)
    """
    with torch.no_grad():
        x = move_to_device(token_ids, device=device)
        y = model(x.unsqueeze(0)).squeeze()
        return y.detach().cpu().numpy()
