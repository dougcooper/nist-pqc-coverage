"""CMVP Entropy Source Validation (ESV) search and certificate pages."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from selectolax.lexbor import LexborHTMLParser as HTMLParser

from .htmlutil import clean

BASE = "https://csrc.nist.gov/projects/cryptographic-module-validation-program"
SEARCH_URL = f"{BASE}/entropy-validations/search"
CERT_URL = f"{BASE}/entropy-validations/certificate/{{cert}}"


@dataclass
class EsvSummary:
    cert: str
    vendor: str
    implementation: str
    date: str

    @property
    def url(self) -> str:
        return certificate_url(self.cert)


@dataclass
class EsvCert:
    cert: str
    url: str
    vendor: str = ""
    implementation: str = ""
    standard: str = ""
    description: str = ""
    version: str = ""
    noise_source: str = ""
    reuse_status: str = ""
    bits_per_output: str = ""
    output_size_bits: str = ""
    operating_environments: list[str] = field(default_factory=list)
    conditioning_cavp_certs: list[str] = field(default_factory=list)
    validated: str = ""
    last_validated: str = ""
    lab: str = ""
    public_use_document_url: str = ""
    vendor_url: str = ""

    @property
    def open_for_reuse(self) -> bool:
        return self.reuse_status.strip().lower() == "open for reuse"


def certificate_url(cert: str) -> str:
    return CERT_URL.format(cert=cert.lstrip("Ee"))


def search_url(page: int = 1, page_size: int = 250) -> str:
    return f"{SEARCH_URL}?ipp={page_size}&submit-btn=Search&page={page}"


def search_pages(total: int, page_size: int = 250) -> int:
    return max(1, (total + page_size - 1) // page_size)


def parse_search(html: str) -> tuple[int, list[EsvSummary]]:
    tree = HTMLParser(html)
    total_match = re.search(r"data-total-results=['\"](\d+)['\"]", html)
    out: list[EsvSummary] = []
    for row in tree.css('tr[id^="cert-row-"]'):
        link = row.css_first('a[id^="cert-number-link"]')
        if not link:
            continue
        href = link.attributes.get("href") or ""
        cert = clean(link.text())
        if not cert.upper().startswith("E"):
            cert = "E" + href.rstrip("/").rsplit("/", 1)[-1]
        vendor = row.css_first('[id^="cert-vendor-name"]')
        implementation = row.css_first('[id^="cert-module-name"]')
        date = row.css_first('[id^="cert-validation-date"]')
        out.append(
            EsvSummary(
                cert=cert,
                vendor=clean(vendor.text()) if vendor else "",
                implementation=clean(implementation.text()) if implementation else "",
                date=clean(date.text()) if date else "",
            )
        )
    total = int(total_match.group(1)) if total_match else len(out)
    return total, out


def _detail_fields(tree: HTMLParser) -> dict[str, str]:
    fields: dict[str, str] = {}
    for row in tree.css("div.row.padrow"):
        label_node = row.css_first("div.col-md-3")
        value_node = row.css_first("div.col-md-9")
        if not label_node or not value_node:
            continue
        label = clean(label_node.text())
        if label and label not in fields:
            fields[label] = clean(value_node.text())
    return fields


def _absolute(href: str) -> str:
    if href.startswith("/"):
        return "https://csrc.nist.gov" + href
    return href


def _entropy(text: str) -> tuple[str, str]:
    match = re.search(
        r"Bits of Entropy per Output:\s*(.*?)\s*Output Size in Bits:\s*(\S+)",
        text,
    ) or re.search(
        r"Entropy per Sample:\s*(.*?)\s*Sample Size:\s*(\S+)",
        text,
    )
    if not match:
        return "", ""
    return clean(match.group(1)).rstrip("."), clean(match.group(2))


def parse_cert(html: str, cert: str, url: str) -> EsvCert:
    tree = HTMLParser(html)
    fields = _detail_fields(tree)
    result = EsvCert(
        cert=cert,
        url=url,
        implementation=fields.get("Implementation Name", ""),
        standard=fields.get("Standard", ""),
        description=fields.get("Description", ""),
        version=fields.get("Version", ""),
        noise_source=fields.get("Noise Source Classification", ""),
        reuse_status=fields.get("Reuse Status", ""),
    )

    for panel in tree.css("div.panel"):
        heading = panel.css_first("h4.panel-title")
        if not heading:
            continue
        title = clean(heading.text())
        body = panel.css_first("div.panel-body")
        if not body:
            continue
        if title == "Vendor" and not result.vendor:
            link = body.css_first("a")
            if link:
                result.vendor = clean(link.text())
                result.vendor_url = _absolute(link.attributes.get("href") or "")
        elif title == "Related Files":
            for link in body.css("a"):
                if "public use" in clean(link.text()).lower():
                    result.public_use_document_url = _absolute(
                        link.attributes.get("href") or ""
                    )
                    break

    for table in tree.css("table.nolinetable"):
        headers = [clean(th.text()) for th in table.css("thead th")]
        if "Operating Environments" not in headers:
            continue
        oe_index = headers.index("Operating Environments")
        conditioning_index = next(
            (i for i, name in enumerate(headers) if "Conditioning" in name), None
        )
        for row in table.css("tbody tr"):
            cells = row.css("td")
            if len(cells) <= oe_index:
                continue
            bits, output = _entropy(clean(cells[0].text()))
            if bits and not result.bits_per_output:
                result.bits_per_output = bits
            if output and not result.output_size_bits:
                result.output_size_bits = output
            for item in cells[oe_index].css("li"):
                value = clean(item.text())
                if value and value not in result.operating_environments:
                    result.operating_environments.append(value)
            if conditioning_index is not None and len(cells) > conditioning_index:
                for item in cells[conditioning_index].css("li"):
                    value = clean(item.text())
                    if value and value not in result.conditioning_cavp_certs:
                        result.conditioning_cavp_certs.append(value)
        break

    history = tree.css_first("#validation-history-table")
    if history:
        rows = history.css("tbody tr")
        if rows:
            first = [clean(td.text()) for td in rows[0].css("td")]
            last = [clean(td.text()) for td in rows[-1].css("td")]
            if first:
                result.validated = first[0]
            if len(first) > 1:
                result.lab = first[1]
            if last:
                result.last_validated = last[0]

    return result
