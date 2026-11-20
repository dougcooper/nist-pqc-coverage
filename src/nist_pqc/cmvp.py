"""CMVP validated-module list, certificate pages, and in-process lists."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from selectolax.lexbor import LexborHTMLParser as HTMLParser

from .htmlutil import clean

BASE = "https://csrc.nist.gov/projects/cryptographic-module-validation-program"
ALL_URL = f"{BASE}/validated-modules/search/all"
CERT_URL = f"{BASE}/certificate/{{cert}}"
MIP_URL = f"{BASE}/modules-in-process/modules-in-process-list"
IUT_URL = f"{BASE}/modules-in-process/iut-list"


@dataclass
class CertSummary:
    cert: str
    vendor: str
    module: str
    module_type: str
    date: str

    @property
    def url(self) -> str:
        return certificate_url(self.cert)


@dataclass
class AlgorithmLink:
    algorithm: str
    cavp_cert: str
    validation_id: int | None


@dataclass
class CmvpCert:
    cert: str
    url: str
    module: str = ""
    vendor: str = ""
    standard: str = ""
    status: str = ""
    sunset: str = ""
    level: str = ""
    caveat: str = ""
    module_type: str = ""
    embodiment: str = ""
    description: str = ""
    security_policy_url: str = ""
    algorithms: list[AlgorithmLink] = field(default_factory=list)
    validated: str = ""
    lab: str = ""

    @property
    def pqc_algorithms(self) -> list[AlgorithmLink]:
        from .cavp import looks_pqc

        return [a for a in self.algorithms if looks_pqc(a.algorithm)]

    @property
    def has_pqc(self) -> bool:
        return bool(self.pqc_algorithms)


@dataclass
class InProcessRow:
    list_name: str  # "MIP" or "IUT"
    module: str
    vendor: str
    standard: str
    status: str
    status_date: str


def certificate_url(cert: str) -> str:
    return CERT_URL.format(cert=cert)


def parse_cert_list(html: str) -> list[CertSummary]:
    tree = HTMLParser(html)
    out: list[CertSummary] = []
    for row in tree.css('tr[id^="cert-row-"]'):
        link = row.css_first('a[id^="cert-number-link"]')
        if not link:
            continue
        href = link.attributes.get("href") or ""
        cert = clean(link.text()) or href.rstrip("/").rsplit("/", 1)[-1]
        vendor = row.css_first('[id^="cert-vendor-name"]')
        module = row.css_first('[id^="cert-module-name"]')
        module_type = row.css_first('[id^="cert-module-type"]')
        date = row.css_first('[id^="cert-validation-dates"]')
        out.append(
            CertSummary(
                cert=cert,
                vendor=clean(vendor.text()) if vendor else "",
                module=clean(module.text()) if module else "",
                module_type=clean(module_type.text()) if module_type else "",
                date=clean(date.text()) if date else "",
            )
        )
    return out


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


def parse_cert(html: str, cert: str, url: str) -> CmvpCert:
    tree = HTMLParser(html)
    fields = _detail_fields(tree)
    result = CmvpCert(
        cert=cert,
        url=url,
        module=fields.get("Module Name", ""),
        standard=fields.get("Standard", ""),
        status=fields.get("Status", ""),
        sunset=fields.get("Sunset Date", ""),
        level=fields.get("Overall Level", ""),
        caveat=fields.get("Caveat", ""),
        module_type=fields.get("Module Type", ""),
        embodiment=fields.get("Embodiment", ""),
        description=fields.get("Description", ""),
    )

    for panel in tree.css("div.panel"):
        heading = panel.css_first("h4.panel-title")
        if heading and clean(heading.text()) == "Vendor":
            body = panel.css_first("div.panel-body")
            link = body.css_first("a") if body else None
            if link:
                result.vendor = clean(link.text())
            break

    for link in tree.css('a[href*="security-policies"]'):
        if "Security Policy" in clean(link.text()):
            href = link.attributes.get("href") or ""
            if href.startswith("/"):
                href = "https://csrc.nist.gov" + href
            result.security_policy_url = href
            break

    # Approved Algorithms: nested label / A-number rows.
    for row in tree.css("div.row.padrow"):
        label_node = row.css_first("div.col-md-3")
        if not label_node or clean(label_node.text()) != "Approved Algorithms":
            continue
        value = row.css_first("div.col-md-9")
        if not value:
            continue
        for striped in value.css("div.row.striped"):
            algorithm = striped.css_first("div.col-md-3")
            number_link = striped.css_first('a[href*="details?validation="]')
            if not algorithm or not number_link:
                continue
            href = number_link.attributes.get("href") or ""
            match = re.search(r"validation=(\d+)", href)
            result.algorithms.append(
                AlgorithmLink(
                    algorithm=clean(algorithm.text()),
                    cavp_cert=clean(number_link.text()),
                    validation_id=int(match.group(1)) if match else None,
                )
            )
        break

    history = tree.css_first("#validation-history-table")
    if history:
        body_rows = history.css("tbody tr")
        if body_rows:
            cells = [clean(td.text()) for td in body_rows[-1].css("td")]
            if cells:
                result.validated = cells[0]
            if len(cells) > 2:
                result.lab = cells[2]

    return result


def parse_in_process(html: str, list_name: str) -> list[InProcessRow]:
    tree = HTMLParser(html)
    out: list[InProcessRow] = []
    for row in tree.css("table tbody tr"):
        cells = row.css("td")
        if len(cells) < 4:
            continue
        module = clean(cells[0].text())
        vendor = clean(cells[1].text())
        vendor = re.sub(r"\s*View Contacts\s*$", "", vendor)
        standard = clean(cells[2].text())
        status_text = clean(cells[3].text())
        if not module:
            continue

        date = ""
        status = status_text
        match = re.search(r"^(.*?)\s*\((\d{1,2}/\d{1,2}/\d{4})\)\s*$", status_text)
        if match:
            status = clean(match.group(1))
            date = match.group(2)
        if list_name == "IUT":
            status, date = "IUT", status_text

        out.append(
            InProcessRow(
                list_name=list_name,
                module=module,
                vendor=vendor,
                standard=standard,
                status=status,
                status_date=date,
            )
        )
    return out


def parse_mip(html: str) -> list[InProcessRow]:
    return parse_in_process(html, "MIP")


def parse_iut(html: str) -> list[InProcessRow]:
    return parse_in_process(html, "IUT")
