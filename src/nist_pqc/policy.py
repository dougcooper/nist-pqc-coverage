"""Extract operational environments from CMVP security policy PDFs.

CMVP certificate pages do not list operating environments.  The authoritative
list is in the non-proprietary security policy, usually as:

    Tested Operational Environments - Software, Firmware, Hybrid:
    ...
    Table 3: Tested Operational Environments - Software, Firmware, Hybrid

    Vendor-Affirmed Operational Environments - Software, Firmware, Hybrid:
    ...

PDF layouts differ between labs, so this module keeps the raw section text and
only reports OS/CPU candidates found in it.  The section text is the source of
truth; the candidates are for quick filtering, not for compliance claims.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

HEADING_RE = re.compile(
    r"^\s*(?P<kind>Tested|Vendor[-\s]Affirmed)\s+"
    r"(?:Operational\s+Environments?|Platforms?)\s*(?P<sep>[-\u2013\u2014:]|$)(?P<rest>.*)$",
    re.IGNORECASE,
)
END_RE = re.compile(
    r"^(?:Table\s+\d+|Excluded\s+Components|\d+(?:\.\d+)+\s+[A-Z]|"
    r"Appendix\s+[A-Z]|Annex\s+[A-Z])",
    re.IGNORECASE,
)
_NOISE_RE = re.compile(
    r"^(?:Page\s+\d+\s+of\s+\d+|©|\u00a9|This document can be reproduced)", re.IGNORECASE
)
OS_TOKEN_RE = re.compile(
    r"(?:Amazon Linux|Red\s+Hat\s+Enterprise\s+Linux|RHEL|Ubuntu|Debian|"
    r"SUSE\s+Linux\s+Enterprise(?:\s+Server)?|SLES|Oracle\s+Linux|CentOS|"
    r"Rocky\s+Linux|AlmaLinux|Alpine\s+Linux|Photon\s+OS|openSUSE|"
    r"Windows\s+Server|Windows|macOS|Mac\s+OS\s+X|Android|iOS|iPadOS|"
    r"FreeBSD|Solaris|AIX|QNX|VxWorks|Linux)"
    r"(?:\s+\d+(?:\.\d+)*)?",
    re.IGNORECASE,
)
CPU_TOKEN_RE = re.compile(
    r"(?:Intel(?:\(R\))?\s+)?Xeon(?:\(R\))?\s+"
    r"(?:(?:Platinum|Gold|Silver|Bronze|Max)\s+)?"
    r"(?:[EWD]-?\d{3,4}[A-Za-z0-9]*|\d{4}[A-Za-z0-9]*)|"
    r"EPYC(?:\s+(?:Genoa|Bergamo|Milan|Rome|Naples|\d{4}[A-Za-z0-9]*|"
    r"\d+(?:st|nd|rd|th)(?:\s+Generation)?))?|Graviton\d*|"
    r"Core(?:\s|\W){0,3}i[3579][A-Za-z0-9-]*|Neoverse\s+\w+|"
    r"Ampere\s+\w+|POWER\d+|Apple\s+M\d\w*|Atom\s+\w*|Cortex-\w+",
    re.IGNORECASE,
)


@dataclass
class PolicySection:
    kind: str  # "tested" or "vendor_affirmed"
    embodiment: str
    page: int
    text: str

    @property
    def os_candidates(self) -> str:
        return _unique(
            [
                match
                for line in self.text.splitlines()
                for match in OS_TOKEN_RE.findall(line)
            ]
        )

    @property
    def cpu_candidates(self) -> str:
        return _unique(
            [
                match
                for line in self.text.splitlines()
                for match in CPU_TOKEN_RE.findall(line)
            ]
        )


def _unique(values: list[str]) -> str:
    seen: dict[str, None] = {}
    for value in values:
        cleaned = re.sub(r"\s+", " ", value).strip()
        if cleaned:
            seen.setdefault(cleaned, None)
    return "; ".join(seen)


def pdf_to_text(pdf_path: Path) -> str:
    """Run pdftotext with layout preserved so table columns survive."""
    binary = shutil.which("pdftotext")
    if binary is None:
        raise RuntimeError(
            "pdftotext not found; install poppler-utils to extract security policies"
        )
    result = subprocess.run(
        [binary, "-layout", str(pdf_path), "-"],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"pdftotext failed for {pdf_path}: {result.stderr.strip()}")
    return result.stdout


def _embodiment(rest: str) -> str:
    rest = re.sub(r"^[-\u2013\u2014:\s]+", "", rest.strip())
    return rest.strip(" :")


def split_sections(text: str) -> list[PolicySection]:
    lines = text.split("\n")
    sections: list[PolicySection] = []
    page = 1
    index = 0
    while index < len(lines):
        line = lines[index]
        if "\f" in line:
            page += line.count("\f")
        match = HEADING_RE.match(line.replace("\f", ""))
        if not match:
            index += 1
            continue
        kind = (
            "tested"
            if match.group("kind").lower().startswith("tested")
            else "vendor_affirmed"
        )
        start_page = page
        body: list[str] = []
        index += 1
        while index < len(lines):
            current = lines[index]
            if "\f" in current:
                page += current.count("\f")
            plain = current.replace("\f", "")
            if HEADING_RE.match(plain) or END_RE.match(plain.strip()):
                break
            if not _NOISE_RE.match(plain.strip()):
                body.append(plain.rstrip())
            index += 1
        section_text = "\n".join(body).strip("\n")
        if section_text:
            sections.append(
                PolicySection(
                    kind=kind,
                    embodiment=_embodiment(match.group("rest")),
                    page=start_page,
                    text=section_text,
                )
            )
    return sections
