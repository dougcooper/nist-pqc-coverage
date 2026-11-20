"""CAVP search + validation detail parsing."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin

from selectolax.lexbor import LexborHTMLParser as HTMLParser

from .htmlutil import clean, parse_list, split_kv

BASE = "https://csrc.nist.gov/projects/cryptographic-algorithm-validation-program"
SEARCH_URL = f"{BASE}/validation-search"
DETAIL_URL = f"{BASE}/details"
DEPS_URL = "https://csrc.nist.gov/csrcservices/public/cavp/RESTApi/Dependencies/{oe_id}"
CAPS_URL = (
    "https://csrc.nist.gov/csrcservices/public/cavp/RESTApi/"
    "ValidationOEAlgorithm/{cap_id}"
)

#: CAVP algorithm ids for the post-quantum schemes NIST currently validates.
PQC_ALGORITHMS: dict[int, tuple[str, str]] = {
    179: ("ML-KEM", "EncapDecap"),
    180: ("ML-KEM", "KeyGen"),
    176: ("ML-DSA", "KeyGen"),
    177: ("ML-DSA", "SigGen"),
    178: ("ML-DSA", "SigVer"),
    181: ("SLH-DSA", "KeyGen"),
    182: ("SLH-DSA", "SigGen"),
    183: ("SLH-DSA", "SigVer"),
    173: ("LMS", "KeyGen"),
    174: ("LMS", "SigGen"),
    175: ("LMS", "SigVer"),
}

PQC_FAMILIES = ("ML-KEM", "ML-DSA", "SLH-DSA", "LMS")

PQC_NAME_RE = re.compile(
    r"\b(ML-KEM|MLKEM|ML-DSA|MLDSA|SLH-DSA|SLHDSA|LMS|XMSS|"
    r"Kyber|Dilithium|SPHINCS\+?|PQC|post[- ]quantum)\b",
    re.IGNORECASE,
)


def family_of(algorithm: str) -> str:
    """Return the PQC family of a CAVP algorithm label, or "" if not PQC."""
    name = clean(algorithm)
    for family in PQC_FAMILIES:
        if name.upper().startswith(family):
            return family
    return ""


def looks_pqc(text: str) -> bool:
    return bool(PQC_NAME_RE.search(text or ""))


FAMILY_ALIASES: list[tuple[str, str]] = [
    (r"ml[- ]?kem|kyber", "ML-KEM"),
    (r"ml[- ]?dsa|dilithium", "ML-DSA"),
    (r"slh[- ]?dsa|sphincs", "SLH-DSA"),
    (r"\blms\b|\bhss\b", "LMS"),
    (r"\bxmss\b", "XMSS"),
]


def family_from_text(text: str) -> str:
    """Best family guess for a CMVP algorithm label or module name."""
    for pattern, family in FAMILY_ALIASES:
        if re.search(pattern, text or "", re.IGNORECASE):
            return family
    return "PQC" if looks_pqc(text) else ""



@dataclass
class SearchRow:
    vendor: str
    implementation: str
    cert: str
    validation_id: int
    date: str
    product_id: int | None

    @property
    def url(self) -> str:
        return f"{DETAIL_URL}?validation={self.validation_id}"


@dataclass
class DetailRow:
    oe_id: int
    oe_name: str
    algorithm: str
    cap_id: int | None
    family: str = ""
    parameter_sets: str = ""
    functions: str = ""

    @property
    def is_pqc(self) -> bool:
        return bool(self.family)


@dataclass
class CavpDetail:
    cert: str
    validation_id: int
    implementation: str
    version: str
    type: str
    description: str
    vendor: str
    first_validated: str
    url: str
    rows: list[DetailRow] = field(default_factory=list)

    @property
    def oe_ids(self) -> list[int]:
        return sorted({row.oe_id for row in self.rows})

    @property
    def pqc_rows(self) -> list[DetailRow]:
        return [row for row in self.rows if row.is_pqc]


def _ints(text: str | None) -> int | None:
    if not text:
        return None
    match = re.search(r"(\d+)", text)
    return int(match.group(1)) if match else None


def parse_search(html: str) -> tuple[int, list[SearchRow]]:
    tree = HTMLParser(html)
    attr = tree.css_first("[data-total-results]")
    total = int(attr.attributes.get("data-total-results", 0)) if attr else 0

    rows: list[SearchRow] = []
    vendor = ""
    for tr in tree.css("table.publications-table tbody tr"):
        cells = tr.css("td")
        if not cells:
            continue
        index = 0
        first_id = cells[0].attributes.get("id") or ""
        if first_id.startswith("vendor-name"):
            vendor = clean(cells[0].text())
            index = 1
        if len(cells) <= index:
            continue

        impl_cell = cells[index]
        impl_link = impl_cell.css_first('a[href*="details?product="]')
        implementation = clean(impl_cell.text())
        product_id = _ints(impl_link.attributes.get("href")) if impl_link else None

        cert_links = tr.css('a[href*="details?validation="]')
        dates = [
            clean(td.text())
            for td in tr.css('td[id^="validation-date"]')
        ]
        for position, link in enumerate(cert_links):
            validation_id = _ints(link.attributes.get("href"))
            if validation_id is None:
                continue
            rows.append(
                SearchRow(
                    vendor=vendor,
                    implementation=implementation,
                    cert=clean(link.text()),
                    validation_id=validation_id,
                    date=dates[position] if position < len(dates) else "",
                    product_id=product_id,
                )
            )
    return total, rows


def parse_detail(html: str, url: str) -> CavpDetail:
    tree = HTMLParser(html)

    def field_value(label: str) -> str:
        for row in tree.css("div.row.padrow"):
            label_node = row.css_first("div.col-md-2")
            if label_node and clean(label_node.text()) == label:
                value_node = row.css_first("div.col-md-10")
                if value_node:
                    return clean(value_node.text())
        return ""

    name_node = tree.css_first("#product-name")
    implementation = clean(name_node.text()) if name_node else field_value("Implementation Name")

    version_node = tree.css_first("#product-version")
    version = clean(version_node.text()) if version_node else field_value("Version")

    type_node = tree.css_first("#product-type")
    module_type = clean(type_node.text()) if type_node else field_value("Type")

    vendor = ""
    for row in tree.css("div.row.padrow"):
        label_node = row.css_first("div.col-md-1")
        if label_node and clean(label_node.text()) == "Vendor":
            vendor_node = row.css_first('a[href^="http"]')
            if vendor_node:
                vendor = clean(vendor_node.text())
            break

    cert = ""
    validation_id = 0
    for link in tree.css('h4 a[href*="details?validation="]'):
        cert = clean(link.text())
        validation_id = _ints(link.attributes.get("href")) or 0
        break
    if not validation_id:
        hidden = tree.css_first('input[name="validation"]')
        if hidden:
            validation_id = _ints(hidden.attributes.get("value")) or 0

    page_text = clean(tree.body.text() if tree.body else "")
    date_match = re.search(r"First Validated:\s*(\d{1,2}/\d{1,2}/\d{4})", page_text)

    rows: list[DetailRow] = []
    for tr in tree.css("table.publications-table tbody tr"):
        cells = tr.css("td")
        if len(cells) < 2:
            continue
        oe_link = cells[0].css_first("a[onclick]")
        if not oe_link:
            continue
        onclick = oe_link.attributes.get("onclick") or ""
        oe_match = re.search(r"ShowDependencies\((\d+),\s*(\d+)\)", onclick)
        if not oe_match:
            continue
        oe_id = int(oe_match.group(1))

        oe_name = clean(cells[0].text())
        oe_name = re.sub(r"\s*(Expand|Collapse)\s*$", "", oe_name)

        cap_link = cells[1].css_first("a[onclick]")
        cap_match = re.search(
            r"ShowCaps\((\d+)\)", cap_link.attributes.get("onclick") or ""
        ) if cap_link else None
        cap_id = int(cap_match.group(1)) if cap_match else None

        bold = cells[1].css_first("b")
        algorithm = clean(bold.text()) if bold else clean(cells[1].text())
        algorithm = re.sub(r"\s*(Expand|Collapse)\s*$", "", algorithm)

        rows.append(
            DetailRow(
                oe_id=oe_id,
                oe_name=oe_name,
                algorithm=algorithm,
                cap_id=cap_id,
                family=family_of(algorithm),
            )
        )

    return CavpDetail(
        cert=cert,
        validation_id=validation_id,
        implementation=implementation,
        version=version,
        type=module_type,
        description=field_value("Description"),
        vendor=vendor,
        first_validated=date_match.group(1) if date_match else "",
        url=url,
        rows=rows,
    )


def parse_dependencies(html: str) -> dict[str, list[dict[str, str]]]:
    """Parse the Dependencies fragment into items keyed by top-level label."""
    out: dict[str, list[dict[str, str]]] = {}
    for node in parse_list(html):
        key, value = split_kv(node.text)
        if not key:
            continue
        item = {"value": value}
        item.update(node.attrs())
        out.setdefault(key.lower(), []).append(item)
    return out


def parse_capabilities(html: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for node in parse_list(html):
        key, value = split_kv(node.text)
        if key:
            out[key.lower()] = value
    return out


def search_pages(total: int, page_size: int = 250) -> int:
    return max(1, math.ceil(total / page_size))


def search_url(algorithm_id: int, page: int = 1, page_size: int = 250) -> str:
    return (
        f"{SEARCH_URL}?searchMode=validation&algorithm={algorithm_id}"
        f"&ipp={page_size}&page={page}"
    )


def detail_url(validation_id: int) -> str:
    return f"{DETAIL_URL}?validation={validation_id}"


def deps_url(oe_id: int) -> str:
    return DEPS_URL.format(oe_id=oe_id)


def caps_url(cap_id: int) -> str:
    return CAPS_URL.format(cap_id=cap_id)


def absolute(url: str) -> str:
    return urljoin(BASE + "/", url)
