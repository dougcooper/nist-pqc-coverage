"""Heuristic mapping of ESV certificates to chipset/platform families.

NIST publishes the operating environments named on an ESV certificate as free
text.  This module groups those strings into a curatable set of chip families so
the dashboard can answer "which platforms already have validated entropy?"  It
is a discovery aid, not a NIST mapping.

The family definitions live in ``platform_families.toml`` beside this module.
Certificates that match no family are returned separately and written to
``platform_unmapped_certs.csv`` so a new platform is never silently hidden.
"""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass, field
from functools import lru_cache
from importlib.resources import files

FAMILY_COLUMNS = [
    "family", "platform_vendor", "category", "open_physical", "esv_certs",
    "open", "physical", "entropy_vendors", "environments",
    "example_environments", "certificates",
]
CERT_COLUMNS = [
    "family", "platform_vendor", "category", "cert", "implementation",
    "vendor", "reuse_status", "noise_source", "bits_per_output",
    "output_size_bits", "validated", "last_validated",
    "public_use_document_url", "url", "matched_environments",
]
UNMAPPED_COLUMNS = [
    "cert", "implementation", "vendor", "reuse_status", "noise_source",
    "bits_per_output", "output_size_bits", "validated", "last_validated",
    "public_use_document_url", "url", "operating_environments",
]


@dataclass(frozen=True)
class Family:
    name: str
    vendor: str
    category: str
    pattern: str
    regex: re.Pattern[str] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "regex", re.compile(self.pattern, re.IGNORECASE))


@lru_cache(maxsize=1)
def load_families() -> tuple[Family, ...]:
    """Load and validate the family definitions from the bundled TOML file."""
    config_path = files("nist_pqc").joinpath("platform_families.toml")
    with config_path.open("rb") as handle:
        config = tomllib.load(handle)

    entries = config.get("family")
    if not isinstance(entries, list) or not entries:
        raise ValueError("platform_families.toml must define at least one [[family]]")

    families: list[Family] = []
    names: set[str] = set()
    for entry in entries:
        name = str(entry.get("name", "")).strip()
        vendor = str(entry.get("vendor", "")).strip()
        category = str(entry.get("category", "")).strip()
        pattern = str(entry.get("pattern", "")).strip()
        if not name or not vendor or not category or not pattern:
            raise ValueError(
                "each [[family]] needs name, vendor, category, and pattern"
            )
        if name in names:
            raise ValueError(f"duplicate platform family: {name}")
        families.append(Family(name, vendor, category, pattern))
        names.add(name)
    return tuple(families)


FAMILIES: tuple[Family, ...] = load_families()


def _environments(row: dict) -> list[str]:
    return [
        value.strip()
        for value in str(row.get("operating_environments") or "").split(";")
        if value.strip()
    ]


def _cert_number(cert: object) -> int:
    digits = re.sub(r"\D", "", str(cert or ""))
    return int(digits) if digits else 0


def _is_strong(row: dict) -> bool:
    return (
        row.get("reuse_status") == "Open for Reuse"
        and row.get("noise_source") == "Physical"
    )


def _cert_sort_key(row: dict) -> tuple:
    # Open + physical first, then open, then newest certificate number.
    return (
        not _is_strong(row),
        row.get("reuse_status") != "Open for Reuse",
        -_cert_number(row.get("cert")),
    )


def _unmapped_row(row: dict) -> dict:
    return {
        "cert": row.get("cert", ""),
        "implementation": row.get("implementation", ""),
        "vendor": row.get("vendor", ""),
        "reuse_status": row.get("reuse_status", ""),
        "noise_source": row.get("noise_source", ""),
        "bits_per_output": row.get("bits_per_output", ""),
        "output_size_bits": row.get("output_size_bits", ""),
        "validated": row.get("validated", ""),
        "last_validated": row.get("last_validated", ""),
        "public_use_document_url": row.get("public_use_document_url", ""),
        "url": row.get("url", ""),
        "operating_environments": row.get("operating_environments", ""),
    }


def build_platforms(
    esv_rows: list[dict],
) -> tuple[list[dict], list[dict], list[dict]]:
    """Return (family summaries, family-certificate matches, unmapped certs).

    ``esv_rows`` are the dicts written to esv_certs.csv.  A certificate can
    match several families and is counted in each; family counts therefore
    overlap.  Unmapped certificates match no configured family.
    """
    family_rows: list[dict] = []
    cert_rows: list[dict] = []
    mapped_certs: set[str] = set()

    for family in FAMILIES:
        matches: list[dict] = []
        for row in esv_rows:
            matched = [
                environment
                for environment in _environments(row)
                if family.regex.search(environment)
            ]
            if not matched:
                continue
            match = {
                "family": family.name,
                "platform_vendor": family.vendor,
                "category": family.category,
                "cert": row.get("cert", ""),
                "implementation": row.get("implementation", ""),
                "vendor": row.get("vendor", ""),
                "reuse_status": row.get("reuse_status", ""),
                "noise_source": row.get("noise_source", ""),
                "bits_per_output": row.get("bits_per_output", ""),
                "output_size_bits": row.get("output_size_bits", ""),
                "validated": row.get("validated", ""),
                "last_validated": row.get("last_validated", ""),
                "public_use_document_url": row.get("public_use_document_url", ""),
                "url": row.get("url", ""),
                "matched_environments": "; ".join(matched),
            }
            match["_environments"] = matched
            matches.append(match)

        if not matches:
            continue

        matches.sort(key=_cert_sort_key)
        open_count = sum(row["reuse_status"] == "Open for Reuse" for row in matches)
        physical_count = sum(row["noise_source"] == "Physical" for row in matches)
        open_physical = sum(_is_strong(row) for row in matches)
        vendors = sorted({row["vendor"] for row in matches if row["vendor"]})
        environments = sorted(
            {environment for row in matches for environment in row["_environments"]}
        )
        examples = sorted(environments, key=lambda value: (len(value), value))[:3]

        family_rows.append(
            {
                "family": family.name,
                "platform_vendor": family.vendor,
                "category": family.category,
                "open_physical": open_physical,
                "esv_certs": len(matches),
                "open": open_count,
                "physical": physical_count,
                "entropy_vendors": len(vendors),
                "environments": len(environments),
                "example_environments": " | ".join(examples),
                "certificates": "; ".join(str(row["cert"]) for row in matches),
            }
        )
        for match in matches:
            mapped_certs.add(str(match["cert"]))
            match.pop("_environments", None)
            cert_rows.append(match)

    family_rows.sort(
        key=lambda row: (
            -row["open_physical"],
            -row["esv_certs"],
            row["family"].lower(),
        )
    )

    unmapped_rows = [
        _unmapped_row(row)
        for row in esv_rows
        if str(row.get("cert", "")) not in mapped_certs
    ]
    unmapped_rows.sort(key=_cert_sort_key)

    return family_rows, cert_rows, unmapped_rows
