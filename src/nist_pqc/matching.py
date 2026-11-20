"""Fuzzy matching for CMVP in-process rows, which carry no algorithm data."""

from __future__ import annotations

import re

from .cavp import CavpDetail, looks_pqc

LEGAL_SUFFIXES = {
    "inc", "inc.", "llc", "l.l.c.", "ltd", "ltd.", "limited", "corp", "corp.",
    "corporation", "co", "co.", "company", "gmbh", "ag", "sa", "sas", "s.a.",
    "bv", "b.v.", "nv", "plc", "pty", "lp", "llp", "kk", "oy", "ab", "as",
    "a/s", "srl", "s.r.l.", "spa", "s.p.a.", "pte", "pte.", "usa", "the",
}

STOPWORDS = {
    "cryptographic", "cryptography", "crypto", "module", "library", "lib",
    "implementation", "software", "hardware", "firmware", "version", "ver",
    "fips", "validated", "validation", "certified", "certificate", "the",
    "a", "an", "of", "for", "and", "with", "based", "on", "in", "to",
    "security", "product", "suite", "engine", "toolkit", "provider",
}


def norm_vendor(name: str) -> str:
    text = (name or "").lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    words = [w for w in text.split() if w and w not in LEGAL_SUFFIXES]
    return " ".join(words)


def vendors_match(a: str, b: str) -> bool:
    na, nb = norm_vendor(a), norm_vendor(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    shorter, longer = sorted((na, nb), key=len)
    return len(shorter) >= 6 and shorter in longer


def name_tokens(name: str) -> set[str]:
    text = (name or "").lower().replace("&", " and ")
    text = re.sub(r"\([^)]*\)", " ", text)  # drop (C_SHA)-style qualifiers
    text = re.sub(r"\bv?\d+(\.\d+)+\b", " ", text)  # drop dotted versions only
    words = re.findall(r"[a-z0-9]+", text)
    return {w for w in words if w not in STOPWORDS and len(w) > 1}


def name_score(module: str, implementation: str) -> float:
    """Fraction of the module name's meaningful tokens found in the CAVP name."""
    target = name_tokens(module)
    candidate = name_tokens(implementation)
    if not target or not candidate:
        return 0.0
    return len(target & candidate) / len(target)


def name_contains(a: str, b: str) -> bool:
    na = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", (a or "").lower())).strip()
    nb = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", (b or "").lower())).strip()
    return bool(na and nb and (na in nb or nb in na))


def match_in_process(
    module: str, vendor: str, validations: list[CavpDetail], threshold: float = 0.5
) -> tuple[str, float, list[CavpDetail]]:
    """Return ``(evidence, score, matched CAVP validations)`` for one row."""
    strong: list[CavpDetail] = []
    best = 0.0
    vendor_hit = False
    for validation in validations:
        if not vendors_match(vendor, validation.vendor):
            continue
        vendor_hit = True
        score = name_score(module, validation.implementation)
        if name_contains(module, validation.implementation):
            score = max(score, 0.75)
        best = max(best, score)
        if score >= threshold:
            strong.append(validation)

    if strong:
        return "cavp_name_match", round(best, 2), strong
    if looks_pqc(module):
        return "name_keyword", round(best, 2), []
    if vendor_hit:
        return "cavp_vendor_only", round(best, 2), []
    return "none", 0.0, []
