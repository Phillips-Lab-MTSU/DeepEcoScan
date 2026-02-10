# This module is leveraged by build fasta and build mapping
# it simply contains the shared behaviors of the two scripts

from __future__ import annotations

import json
import re
from dataclasses import replace
from pathlib import Path
from typing import Any, Dict, Optional

from dnadb import dna, fasta

# removes non-dna characters from the FASTA entry sequence
def clean_entry(entry: fasta.FastaEntry) -> fasta.FastaEntry:
    sequence = re.sub(rf"[^{dna.ALL_BASES}]", "", entry.sequence)
    return replace(entry, sequence=sequence)

# creates the directory if one isnt made already
def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)

# ensures we dont overwrite a given directory unless we force it
def refuse_overwrite(path: Path, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError(
            f"Refusing to overwrite existing file: {path}\n"
            f"Pass --force to overwrite."
        )


def write_json(path: Path, obj: Dict[str, Any]) -> None:
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")


def default_paths(input_dir: Path) -> Dict[str, Path]:
    return {
        "fasta": input_dir / "P_A_221205_cmfp.trim.contigs.pcr.good.unique.good.filter.unique.precluster.denovo.vsearch.pick.opti_mcc.0.03.pick.0.03.abund.0.03.pick.fasta",
        "otu_list": input_dir / "221205_cmfp.trim.contigs.pcr.good.unique.good.filter.unique.precluster.denovo.vsearch.asv.list",
        "otu_shared": input_dir / "221205_cmfp.trim.contigs.pcr.good.unique.good.filter.unique.precluster.denovo.vsearch.asv.shared",
        "metadata": input_dir / "230320_sfdspatial_meta_clean.csv",
        "taxonomy": input_dir / "taxonomy.tsv",
    }
