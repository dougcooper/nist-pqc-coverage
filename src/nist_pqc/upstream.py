"""Map certificate vendor/product text to the underlying crypto library, when known.

Many CMVP certificates are rebrands or OEM builds of a small number of validated
libraries.  This is a keyword hint, not an authoritative component mapping; it is
meant to collapse vendor counts in the dashboard.
"""

from __future__ import annotations

import re

RULES: list[tuple[str, str]] = [
    ("AWS-LC", r"\baws[-\s]?lc\b|\bamazon\s+web\s+services\b.*\blc\b"),
    ("BoringSSL", r"\bboring(?:ssl|crypto)\b"),
    ("OpenSSL", r"\bopenssl\b"),
    ("wolfSSL", r"\bwolf(?:ssl|crypt)\b"),
    ("mbed TLS", r"\bmbed\s*tls\b"),
    ("SymCrypt", r"\bsymcrypt\b"),
    ("Bouncy Castle", r"\bbouncy\s*castle\b"),
    ("leancrypto", r"\bleancrypto\b"),
    ("liboqs", r"\bliboqs\b"),
    ("mlkem-native", r"\bmlkem[-_]native\b"),
    ("Intel IPP Crypto", r"\bipp[-\s]?crypto\b|\bcryptography\s+primitives\s+library\b"),
    ("Intel Multi-Buffer", r"\bmulti[-\s]?buffer\b"),
    ("PQShield PQCryptoLib", r"\bpqcryptolib\b"),
    ("CryptoNext C-QSL", r"\bc[-_]qsl\b"),
    ("GnuTLS", r"\bgnutls\b"),
    ("Libgcrypt", r"\blibgcrypt\b"),
    ("Mozilla NSS", r"\bnss\b|\bmozilla\b"),
    ("corecrypto", r"\bcorecrypto\b"),
    ("Crypto++", r"crypto\+\+"),
    ("Botan", r"\bbotan\b"),
]


def classify(*parts: str) -> str:
    text = " ".join(part for part in parts if part)
    for name, pattern in RULES:
        if re.search(pattern, text, re.IGNORECASE):
            return name
    return ""
