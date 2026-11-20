"""Infer the implementation language of a validated cryptographic module.

NIST publishes no structured implementation-language field.  This module uses
three sources, strongest first:

1. ``stated`` - the module description says so outright, e.g. "implemented in
   pure Java" or "written in C".  Only a verb immediately followed by a
   language counts; "C language API" describes the interface, not the
   implementation, and is deliberately ignored.
2. ``name`` - an unmistakable product name, e.g. "BC-FNA ... .NET" or "Go
   Cryptographic Module".
3. ``upstream`` - the curated map below from a known upstream library (the same
   keyword match used in the ``upstream`` column) to its implementation
   language.

Hardware and firmware have no sensible language field unless NIST or the
upstream map supplies one; when nothing does, they are ``not_applicable``
rather than ``unknown``.  Everything else is ``none`` with an empty language.
This is a hint, not a compliance claim: the source column is there so a UI can
keep NIST's own statements separate from inferences.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from . import upstream

#: Languages named by NIST, longest first so C++ / C# win over plain C.
_LANGUAGE = (
    r"C\+\+|C#|CSharp|Objective-C|JavaScript|Java|C(?:89|90|99|11|17)?|Golang|Go|Rust|Python|Ada|"
    r"Assembly|Assembler|Swift|Kotlin|TypeScript"
)

# "written in C", "implemented in the C programming language", "coded in pure
# Java".  The lookahead keeps "Java" from matching "JavaScript" and lets "C#"
# match even though # is not a word character.
_STATED_RE = re.compile(
    rf"\b(?:written|implemented|coded|developed|programmed)\s+(?:in|using)\s+"
    rf"(?:the\s+)?(?:pure\s+|generic\s+)?"
    rf"(?P<lang>{_LANGUAGE})(?![A-Za-z0-9_+#])",
    re.IGNORECASE,
)

# "an implementation in Rust" is explicit; the description just uses a noun
# instead of the passive verb form.
_IMPL_IN_RE = re.compile(
    rf"\bimplementation\s+in\s+(?:the\s+)?(?:pure\s+|generic\s+)?"
    rf"(?P<lang>{_LANGUAGE})(?![A-Za-z0-9_+#])",
    re.IGNORECASE,
)

# "a portable C90 implementation", "a Rust implementation", "an open source C
# library".  "C language API" does not match because API is not in the noun set.
_LANG_NOUN_RE = re.compile(
    rf"(?<![A-Za-z0-9_+#])(?P<lang>{_LANGUAGE})"
    rf"(?:\s+(?:language|backend))?\s+(?:implementation|library)\b",
    re.IGNORECASE,
)

# "usable by applications written in C" describes the caller, not the module.
_CALLER_RE = re.compile(
    r"(?:applications?|apps?|programs?|clients?|callers?|tools?)\s+"
    r"(?:that\s+are\s+|which\s+are\s+)?$",
    re.IGNORECASE,
)

_ALIASES = {
    "c": "C",
    "c89": "C",
    "c90": "C",
    "c99": "C",
    "c11": "C",
    "c17": "C",
    "c++": "C++",
    "c#": "C#",
    "csharp": "C#",
    "java": "Java",
    "javascript": "JavaScript",
    "typescript": "TypeScript",
    "go": "Go",
    "golang": "Go",
    "rust": "Rust",
    "python": "Python",
    "ada": "Ada",
    "assembly": "Assembly",
    "assembler": "Assembly",
    "objective-c": "Objective-C",
    "swift": "Swift",
    "kotlin": "Kotlin",
}

#: Upstream library -> language.  Only unambiguous libraries belong here;
#: Bouncy Castle ships Java and C# builds and is handled by the name rules.
_UPSTREAM_LANGUAGES = {
    "AWS-LC": "C",
    "BoringSSL": "C",
    "OpenSSL": "C",
    "wolfSSL": "C",
    "mbed TLS": "C",
    "SymCrypt": "C",
    "GnuTLS": "C",
    "Libgcrypt": "C",
    "Mozilla NSS": "C",
    "corecrypto": "C",
    "leancrypto": "C",
    "liboqs": "C",
    "mlkem-native": "C",
    "Intel IPP Crypto": "C",
    "Intel Multi-Buffer": "C",
    "PQShield PQCryptoLib": "C",
    "CryptoNext C-QSL": "C",
    "Crypto++": "C++",
    "Botan": "C++",
}

_NAME_RULES: list[tuple[re.Pattern[str], str]] = [
    # Bouncy Castle has Java and C# products; the certificate name says which.
    (re.compile(r"\bBC-FNA\b|\bbouncy\s*castle\b[^.]*?(?:\.NET|C#)", re.IGNORECASE), "C#"),
    (re.compile(r"\bBC-FJA\b|\bbouncy\s*castle\b[^.]*?java", re.IGNORECASE), "Java"),
    # CAVP implementation names often carry the build variant: "(C)",
    # "Kernel_C", "without PAA - C implementation".
    (re.compile(r"\(\s*C\s*\)", re.IGNORECASE), "C"),
    (re.compile(r"\bkernel[\s_-]+c\b", re.IGNORECASE), "C"),
    (re.compile(r"\bC[\s_-]+implementation\b", re.IGNORECASE), "C"),
    (re.compile(r"\bcrypto\s+module\s+for\s+c\b", re.IGNORECASE), "C"),
    (re.compile(r"\b[A-Za-z0-9_.]+-rs\b", re.IGNORECASE), "Rust"),
    (re.compile(r"\bjava\b(?!script)", re.IGNORECASE), "Java"),
    (re.compile(r"\brust\b", re.IGNORECASE), "Rust"),
    (re.compile(r"\bc\+\+", re.IGNORECASE), "C++"),
]

# "Go" is too common in product names ("Access Point Go") to trust on its own.
# Require a known Go vendor and an unambiguous module name.
_GO_NAME_RE = re.compile(
    r"\b(?:Go\s+Cryptographic\s+Module|Native\s+Go\s+Module|Go\s+Module)\b",
    re.IGNORECASE,
)
_GO_VENDOR_RE = re.compile(
    r"\b(?:Geomys|Virtru|Cisco|Hewlett\s+Packard\s+Enterprise|SafeLogic)\b",
    re.IGNORECASE,
)

# Hardware and firmware only get a language when NIST or the upstream map gives
# one.  Otherwise the field is not applicable, not unknown.
_NOT_APPLICABLE_KINDS = {"hardware", "firmware", "firmware_hybrid"}


@dataclass(frozen=True)
class Language:
    name: str = ""
    source: str = "none"  # stated | name | upstream | not_applicable | none


def _normalize(token: str) -> str:
    return _ALIASES.get(token.lower(), token)


def _from_description(description: str) -> Language | None:
    text = description or ""
    matches = []
    for pattern, trust_go in (
        (_STATED_RE, True),
        (_IMPL_IN_RE, True),
        (_LANG_NOUN_RE, False),
    ):
        for match in pattern.finditer(text):
            # "Go library" is too ambiguous; only explicit "in Go" / "written
            # in Go" counts, and those come from the other two patterns.
            if not trust_go and match.group("lang").lower() == "go":
                continue
            matches.append(match)
    for match in sorted(matches, key=lambda item: item.start()):
        before = text[max(0, match.start() - 48) : match.start()]
        if _CALLER_RE.search(before):
            continue
        return Language(_normalize(match.group("lang")), "stated")
    return None


def _from_name(text: str) -> Language | None:
    if _GO_NAME_RE.search(text or "") and _GO_VENDOR_RE.search(text or ""):
        return Language("Go", "name")
    for pattern, language in _NAME_RULES:
        if pattern.search(text or ""):
            return Language(language, "name")
    return None


def classify(
    description: str = "",
    vendor: str = "",
    product: str = "",
    module_kind: str = "",
) -> Language:
    """Best-effort implementation language with the evidence that produced it."""
    stated = _from_description(description)
    if stated:
        return stated

    named = _from_name(f"{vendor} {product}".strip())
    if named:
        return named

    library = upstream.classify(vendor, product, description)
    if language := _UPSTREAM_LANGUAGES.get(library):
        return Language(language, "upstream")

    if module_kind in _NOT_APPLICABLE_KINDS:
        return Language(source="not_applicable")

    return Language()
