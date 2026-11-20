"""``nist-pqc scrape``: orchestrate CAVP + CMVP and write the CSV dataset."""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import cavp, cmvp, export, matching, policy, upstream
from .http import Fetcher
from .normalize import normalize_oe

CAVP_VALIDATION_COLUMNS = [
    "cert", "validation_id", "vendor", "implementation", "version", "type",
    "first_validated", "url", "n_algorithms", "n_pqc_algorithms",
    "pqc_algorithms", "pqc_families", "cmvp_status", "cmvp_certs",
    "in_process_modules",
]
CAVP_OE_COLUMNS = [
    "cert", "validation_id", "vendor", "oe_id", "oe_name", "algorithm",
    "pqc_family", "parameter_sets", "functions",
]
OE_COLUMNS = [
    "oe_id", "cert", "validation_id", "vendor", "oe_name", "software",
    "processor", "cpu_family", "cpu_vendor", "cpu_series", "os_family",
    "os_name", "os_product", "os_version", "arch", "target",
    "pqc_algorithms", "pqc_families",
]
CMVP_CERT_COLUMNS = [
    "cert", "vendor", "module", "standard", "status", "level", "module_type",
    "embodiment", "upstream", "validated", "sunset", "lab",
    "security_policy_url", "url", "pqc_algorithms", "pqc_families", "cavp_certs",
]
CMVP_LINK_COLUMNS = [
    "cmvp_cert", "cavp_cert", "cavp_validation_id", "algorithm", "pqc_family",
]
IN_PROCESS_COLUMNS = [
    "list", "module", "vendor", "standard", "status", "status_date",
    "pqc_evidence", "match_score", "matched_cavp_certs",
    "matched_implementations", "url",
]
POLICY_COLUMNS = [
    "cert", "kind", "embodiment", "page", "pdf_url",
    "os_candidates", "cpu_candidates", "section_text",
]
COVERAGE_COLUMNS = [
    "source", "record_id", "cert", "vendor", "product", "module_type",
    "upstream", "status", "validated", "url", "oe_id", "oe_name", "os_family",
    "os_name", "os_product", "os_version", "arch", "cpu", "cpu_vendor",
    "cpu_series", "target", "pqc_algorithm", "pqc_family", "parameter_sets",
    "functions", "evidence",
]


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def unique(values) -> list[str]:
    return sorted({v for v in values if v})


def fetch_search(fetcher: Fetcher, algorithm_id: int) -> tuple[int, list[cavp.SearchRow]]:
    total, rows = cavp.parse_search(fetcher.get_text(cavp.search_url(algorithm_id)))
    for page in range(2, cavp.search_pages(total) + 1):
        _, more = cavp.parse_search(
            fetcher.get_text(cavp.search_url(algorithm_id, page))
        )
        rows.extend(more)
    return total, rows


def _fetch_caps(fetcher: Fetcher, row: cavp.DetailRow) -> None:
    caps = cavp.parse_capabilities(fetcher.get_html_fragment(cavp.caps_url(row.cap_id)))
    row.parameter_sets = caps.get("parameter sets", "")
    row.functions = caps.get("functions", "")


def load_cavp(fetcher: Fetcher, limit: int = 0, workers: int = 1) -> list[cavp.CavpDetail]:
    found: dict[int, cavp.SearchRow] = {}
    for algorithm_id, (family, operation) in cavp.PQC_ALGORITHMS.items():
        total, rows = fetch_search(fetcher, algorithm_id)
        log(f"cavp search {family} {operation} (id {algorithm_id}): {total} results")
        for row in rows:
            found.setdefault(row.validation_id, row)

    ids = sorted(found)
    if limit:
        ids = ids[:limit]
    log(f"cavp: {len(ids)} unique validations to fetch")

    details: list[cavp.CavpDetail] = []
    pool = ThreadPoolExecutor(max_workers=workers) if workers > 1 else None
    try:
        for position, validation_id in enumerate(ids, start=1):
            url = cavp.detail_url(validation_id)
            detail = cavp.parse_detail(fetcher.get_text(url), url)
            rows = [row for row in detail.pqc_rows if row.cap_id is not None]
            if pool is not None:
                list(pool.map(lambda row: _fetch_caps(fetcher, row), rows))
            else:
                for row in rows:
                    _fetch_caps(fetcher, row)
            details.append(detail)
            if position % 25 == 0 or position == len(ids):
                log(f"cavp details {position}/{len(ids)}")
    finally:
        if pool is not None:
            pool.shutdown()
    return details


def load_operating_environments(
    fetcher: Fetcher, details: list[cavp.CavpDetail], workers: int = 1
) -> dict[int, dict[str, str]]:
    names: dict[int, str] = {}
    for detail in details:
        for row in detail.pqc_rows:
            names.setdefault(row.oe_id, row.oe_name)

    def fetch_one(oe_id: int) -> tuple[int, dict[str, str]]:
        dependencies = cavp.parse_dependencies(
            fetcher.get_html_fragment(cavp.deps_url(oe_id))
        )
        return oe_id, normalize_oe(names[oe_id], dependencies)

    records: dict[int, dict[str, str]] = {}
    oe_ids = sorted(names)
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for position, (oe_id, record) in enumerate(pool.map(fetch_one, oe_ids), start=1):
            records[oe_id] = record
            if position % 100 == 0 or position == len(oe_ids):
                log(f"cavp operating environments {position}/{len(oe_ids)}")
    return records


def load_cmvp(
    fetcher: Fetcher, limit: int = 0, workers: int = 1
) -> tuple[list[cmvp.CmvpCert], list[cmvp.CmvpCert]]:
    summaries = cmvp.parse_cert_list(fetcher.get_text(cmvp.ALL_URL))
    if limit:
        summaries = summaries[:limit]
    log(f"cmvp: {len(summaries)} certificates to fetch")

    def fetch_one(summary: cmvp.CertSummary) -> cmvp.CmvpCert:
        return cmvp.parse_cert(fetcher.get_text(summary.url), summary.cert, summary.url)

    certs: list[cmvp.CmvpCert] = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for position, cert in enumerate(pool.map(fetch_one, summaries), start=1):
            certs.append(cert)
            if position % 50 == 0 or position == len(summaries):
                log(f"cmvp certificates {position}/{len(summaries)}")

    pqc = [cert for cert in certs if cert.has_pqc]
    log(f"cmvp: {len(pqc)} certificates include a PQC algorithm")
    return pqc, certs


def load_in_process(fetcher: Fetcher) -> list[cmvp.InProcessRow]:
    mip = cmvp.parse_mip(fetcher.get_text(cmvp.MIP_URL))
    iut = cmvp.parse_iut(fetcher.get_text(cmvp.IUT_URL))
    log(f"cmvp in process: {len(mip)} modules-in-process, {len(iut)} IUT")
    return mip + iut


def load_policies(
    fetcher: Fetcher, certs: list[cmvp.CmvpCert], cache_dir: str | Path = ".cache"
) -> list[dict]:
    """Download security policies and pull out tested/vendor-affirmed OE sections."""
    pdf_dir = Path(cache_dir) / "policies"
    pdf_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    found = 0
    for position, cert in enumerate(certs, start=1):
        if not cert.security_policy_url:
            continue
        pdf_path = pdf_dir / f"{cert.cert}.pdf"
        if not pdf_path.exists() or fetcher.refresh:
            try:
                pdf_path.write_bytes(fetcher.get_bytes(cert.security_policy_url, ".pdf"))
            except Exception as exc:  # noqa: BLE001 - a missing policy must not stop the run
                log(f"policy {cert.cert}: download failed: {exc}")
                continue
        try:
            sections = policy.split_sections(policy.pdf_to_text(pdf_path))
        except Exception as exc:  # noqa: BLE001 - pdftotext or a scanned PDF
            log(f"policy {cert.cert}: extract failed: {exc}")
            continue
        if sections:
            found += 1
        for section in sections:
            rows.append(
                {
                    "cert": cert.cert,
                    "kind": section.kind,
                    "embodiment": section.embodiment,
                    "page": section.page,
                    "pdf_url": cert.security_policy_url,
                    "os_candidates": section.os_candidates,
                    "cpu_candidates": section.cpu_candidates,
                    "section_text": section.text,
                }
            )
        if position % 10 == 0 or position == len(certs):
            log(f"policies {position}/{len(certs)} ({found} with OE sections)")
    return rows


def scrape(args: argparse.Namespace) -> None:
    out_dir = Path(args.out)
    fetcher = Fetcher(
        cache_dir=args.cache_dir,
        delay=args.delay,
        refresh=args.refresh,
        max_age_days=args.max_age_days,
        verbose=not args.quiet,
    )

    details = load_cavp(fetcher, limit=args.limit, workers=args.workers)
    oes = load_operating_environments(fetcher, details, workers=args.workers)
    pqc_certs, _ = load_cmvp(fetcher, limit=args.limit, workers=args.workers)
    in_process = load_in_process(fetcher)

    active_certs = [c for c in pqc_certs if c.status.lower() == "active"]
    if args.include_historical:
        active_certs = pqc_certs
    excluded = len(pqc_certs) - len(active_certs)
    policy_rows = (
        [] if args.no_policies else load_policies(fetcher, active_certs, args.cache_dir)
    )

    cavp_by_cert = {detail.cert: detail for detail in details}
    cavp_by_id = {detail.validation_id: detail for detail in details}

    # --- CMVP -> CAVP links ------------------------------------------------
    links: list[dict] = []
    link_keys: set[tuple[str, str, str]] = set()
    cmvp_by_cavp: dict[str, list[str]] = defaultdict(list)
    for cert in active_certs:
        for algorithm in cert.pqc_algorithms:
            detail = cavp_by_cert.get(algorithm.cavp_cert)
            if detail is None and algorithm.validation_id:
                detail = cavp_by_id.get(algorithm.validation_id)
            key = (cert.cert, algorithm.cavp_cert, algorithm.algorithm)
            if key in link_keys:
                continue
            link_keys.add(key)
            links.append(
                {
                    "cmvp_cert": cert.cert,
                    "cavp_cert": algorithm.cavp_cert,
                    "cavp_validation_id": detail.validation_id if detail else "",
                    "algorithm": algorithm.algorithm,
                    "pqc_family": cavp.family_from_text(algorithm.algorithm),
                }
            )
            cmvp_by_cavp[algorithm.cavp_cert].append(cert.cert)

    # --- in-process inference ---------------------------------------------
    strong_by_cert: dict[str, list[cmvp.InProcessRow]] = defaultdict(list)
    in_process_rows: list[dict] = []
    matches: list[list[cavp.CavpDetail]] = []
    for row in in_process:
        evidence, score, matched = matching.match_in_process(
            row.module, row.vendor, details
        )
        matches.append(matched)
        if evidence == "cavp_name_match":
            for detail in matched:
                strong_by_cert[detail.cert].append(row)
        in_process_rows.append(
            {
                "list": row.list_name,
                "module": row.module,
                "vendor": row.vendor,
                "standard": row.standard,
                "status": row.status,
                "status_date": export.to_iso(row.status_date),
                "pqc_evidence": evidence,
                "match_score": score,
                "matched_cavp_certs": "; ".join(unique(d.cert for d in matched)),
                "matched_implementations": "; ".join(
                    unique(d.implementation for d in matched)
                ),
                "url": cmvp.MIP_URL if row.list_name == "MIP" else cmvp.IUT_URL,
            }
        )
    if args.verbose_matches:
        for row in in_process_rows:
            print(
                f"{row['list']:3} {row['pqc_evidence']:18} {row['match_score']:>4} "
                f"{row['vendor'][:30]:30} {row['module'][:60]} -> {row['matched_cavp_certs']}",
                file=sys.stderr,
            )

    # --- per-CAVP status ---------------------------------------------------
    def cavp_status(cert: str) -> str:
        if cmvp_by_cavp.get(cert):
            return "active"
        if strong_by_cert.get(cert):
            return "in_process"
        return "none_yet"

    # --- CAVP outputs ------------------------------------------------------
    cavp_rows: list[dict] = []
    cavp_oe_rows: list[dict] = []
    oe_rows: list[dict] = []
    for detail in details:
        pqc_rows = detail.pqc_rows
        families = unique(row.family for row in pqc_rows)
        algorithms = unique(row.algorithm for row in pqc_rows)
        pipeline = strong_by_cert.get(detail.cert, [])
        cavp_rows.append(
            {
                "cert": detail.cert,
                "validation_id": detail.validation_id,
                "vendor": detail.vendor,
                "implementation": detail.implementation,
                "version": detail.version,
                "type": detail.type,
                "first_validated": export.to_iso(detail.first_validated),
                "url": detail.url,
                "n_algorithms": len({row.algorithm for row in detail.rows}),
                "n_pqc_algorithms": len({row.algorithm for row in pqc_rows}),
                "pqc_algorithms": "; ".join(algorithms),
                "pqc_families": "; ".join(families),
                "cmvp_status": cavp_status(detail.cert),
                "cmvp_certs": "; ".join(unique(cmvp_by_cavp.get(detail.cert, []))),
                "in_process_modules": "; ".join(unique(row.module for row in pipeline)),
            }
        )

        pqc_oe_ids = {row.oe_id for row in pqc_rows}
        for row in detail.rows:
            if row.oe_id not in pqc_oe_ids:
                continue
            cavp_oe_rows.append(
                {
                    "cert": detail.cert,
                    "validation_id": detail.validation_id,
                    "vendor": detail.vendor,
                    "oe_id": row.oe_id,
                    "oe_name": row.oe_name,
                    "algorithm": row.algorithm,
                    "pqc_family": row.family,
                    "parameter_sets": row.parameter_sets,
                    "functions": row.functions,
                }
            )

        for oe_id in sorted(pqc_oe_ids):
            record = dict(oes[oe_id])
            oe_algorithms = [row.algorithm for row in pqc_rows if row.oe_id == oe_id]
            oe_families = [row.family for row in pqc_rows if row.oe_id == oe_id]
            record.update(
                {
                    "oe_id": oe_id,
                    "cert": detail.cert,
                    "validation_id": detail.validation_id,
                    "vendor": detail.vendor,
                    "pqc_algorithms": "; ".join(unique(oe_algorithms)),
                    "pqc_families": "; ".join(unique(oe_families)),
                }
            )
            oe_rows.append(record)

    # --- CMVP outputs ------------------------------------------------------
    cmvp_rows: list[dict] = []
    for cert in active_certs:
        families = unique(
            cavp.family_from_text(algorithm.algorithm)
            for algorithm in cert.pqc_algorithms
        )
        cmvp_rows.append(
            {
                "cert": cert.cert,
                "vendor": cert.vendor,
                "module": cert.module,
                "standard": cert.standard,
                "status": cert.status,
                "level": cert.level,
                "module_type": cert.module_type,
                "embodiment": cert.embodiment,
                "upstream": upstream.classify(
                    cert.vendor, cert.module, cert.description
                ),
                "validated": export.to_iso(cert.validated),
                "sunset": export.to_iso(cert.sunset),
                "lab": cert.lab,
                "security_policy_url": cert.security_policy_url,
                "url": cert.url,
                "pqc_algorithms": "; ".join(
                    unique(a.algorithm for a in cert.pqc_algorithms)
                ),
                "pqc_families": "; ".join(families),
                "cavp_certs": "; ".join(
                    unique(a.cavp_cert for a in cert.pqc_algorithms)
                ),
            }
        )

    # --- flat coverage table ----------------------------------------------
    coverage: dict[tuple, dict] = {}

    def add_coverage(
        *, source: str, record_id: str, cert: str, vendor: str, product: str,
        module_type: str, status: str, validated: str, url: str,
        row: cavp.DetailRow, evidence: str,
    ) -> None:
        key = (source, record_id, row.oe_id, row.algorithm)
        if key in coverage:
            return
        oe = oes.get(row.oe_id, {})
        coverage[key] = {
            "source": source,
            "record_id": record_id,
            "cert": cert,
            "vendor": vendor,
            "product": product,
            "module_type": module_type,
            "upstream": upstream.classify(vendor, product),
            "status": status,
            "validated": export.to_iso(validated),
            "url": url,
            "oe_id": row.oe_id,
            "oe_name": row.oe_name,
            "os_family": oe.get("os_family", ""),
            "os_name": oe.get("os_name", ""),
            "os_product": oe.get("os_product", ""),
            "os_version": oe.get("os_version", ""),
            "arch": oe.get("arch", ""),
            "cpu": oe.get("processor", ""),
            "cpu_vendor": oe.get("cpu_vendor", ""),
            "cpu_series": oe.get("cpu_series", ""),
            "target": oe.get("target", ""),
            "pqc_algorithm": row.algorithm,
            "pqc_family": row.family,
            "parameter_sets": row.parameter_sets,
            "functions": row.functions,
            "evidence": evidence,
        }

    for detail in details:
        for row in detail.pqc_rows:
            add_coverage(
                source="CAVP", record_id=detail.cert, cert=detail.cert,
                vendor=detail.vendor, product=detail.implementation,
                module_type=detail.type, status=cavp_status(detail.cert),
                validated=detail.first_validated, url=detail.url,
                row=row, evidence="cavp_validated",
            )

    for cert in active_certs:
        for algorithm in cert.pqc_algorithms:
            detail = cavp_by_cert.get(algorithm.cavp_cert)
            if detail is None and algorithm.validation_id:
                detail = cavp_by_id.get(algorithm.validation_id)
            if detail is None:
                continue
            family = cavp.family_from_text(algorithm.algorithm)
            rows = [row for row in detail.pqc_rows if row.family == family]
            for row in rows or detail.pqc_rows:
                add_coverage(
                    source="CMVP", record_id=cert.cert, cert=cert.cert,
                    vendor=cert.vendor, product=cert.module,
                    module_type=cert.module_type, status=cert.status,
                    validated=cert.validated, url=cert.url,
                    row=row, evidence="cmvp_active",
                )

    for row, matched in zip(in_process, matches):
        for detail in matched:
            for oe_row in detail.pqc_rows:
                add_coverage(
                    source=f"CMVP-{row.list_name}", record_id=row.module,
                    cert="", vendor=row.vendor, product=row.module,
                    module_type="", status=row.status,
                    validated=row.status_date,
                    url=cmvp.MIP_URL if row.list_name == "MIP" else cmvp.IUT_URL,
                    row=oe_row, evidence="cavp_name_match",
                )

    coverage_rows = sorted(
        coverage.values(),
        key=lambda r: (r["source"], r["vendor"], r["product"], r["os_name"], r["arch"], r["pqc_algorithm"]),
    )

    # --- coverage analyses -------------------------------------------------
    cavp_only = {
        detail.cert for detail in details if cavp_status(detail.cert) == "none_yet"
    }
    validated_rows = [
        row
        for row in coverage_rows
        if row["source"] == "CMVP"
        or (row["source"] == "CAVP" and row["record_id"] in cavp_only)
    ]
    with_in_process = validated_rows + [
        row for row in coverage_rows if row["source"] in ("CMVP-MIP", "CMVP-IUT")
    ]
    software_validated = [
        row for row in validated_rows if row["module_type"].upper().startswith("SOFTWARE")
    ]
    software_with_in_process = [
        row for row in with_in_process if row["module_type"].upper().startswith("SOFTWARE")
    ]
    target_rows = (
        export.coverage_targets(validated_rows, "validated")
        + export.coverage_targets(with_in_process, "with_in_process")
        + export.coverage_targets(software_validated, "validated_software")
        + export.coverage_targets(software_with_in_process, "with_in_process_software")
    )
    greedy_rows = (
        export.coverage_greedy(validated_rows, "validated")
        + export.coverage_greedy(with_in_process, "with_in_process")
        + export.coverage_greedy(software_validated, "validated_software")
        + export.coverage_greedy(software_with_in_process, "with_in_process_software")
    )

    # --- write -------------------------------------------------------------
    export.write_csv(out_dir / "cavp_validations.csv", cavp_rows, CAVP_VALIDATION_COLUMNS)
    export.write_csv(out_dir / "cavp_oe_algorithms.csv", cavp_oe_rows, CAVP_OE_COLUMNS)
    export.write_csv(out_dir / "operating_environments.csv", oe_rows, OE_COLUMNS)
    export.write_csv(out_dir / "cmvp_certs.csv", cmvp_rows, CMVP_CERT_COLUMNS)
    export.write_csv(out_dir / "cmvp_cavp_links.csv", links, CMVP_LINK_COLUMNS)
    export.write_csv(out_dir / "cmvp_in_process.csv", in_process_rows, IN_PROCESS_COLUMNS)
    export.write_csv(out_dir / "cmvp_policy_sections.csv", policy_rows, POLICY_COLUMNS)
    export.write_csv(out_dir / "pqc_coverage.csv", coverage_rows, COVERAGE_COLUMNS)
    export.write_csv(out_dir / "coverage_targets.csv", target_rows, [
        "variant", "rank", "target", "os_name", "arch", "os_family",
        "vendors", "products", "certs", "pct_products",
        "cumulative_products", "cumulative_pct_products",
        "cumulative_vendors", "cumulative_pct_vendors",
    ])
    export.write_csv(out_dir / "coverage_greedy.csv", greedy_rows, [
        "variant", "rank", "vendor", "product", "record_id", "targets_covered",
        "targets_total", "cumulative_targets", "pct_targets", "universe_targets",
    ])

    dates = [
        row["validated"] for row in coverage_rows if row["validated"]
    ] + [row["validated"] for row in cmvp_rows if row["validated"]]
    data_as_of = max(dates) if dates else ""

    counts = {
        "cavp_pqc_validations": len(cavp_rows),
        "cavp_operating_environments": len(oe_rows),
        "cavp_oe_algorithm_rows": len(cavp_oe_rows),
        "cmvp_pqc_certificates": len(cmvp_rows),
        "cmvp_in_process_rows": len(in_process_rows),
        "cmvp_in_process_matched": sum(
            1 for row in in_process_rows if row["pqc_evidence"] == "cavp_name_match"
        ),
        "policy_sections": len(policy_rows),
        "policy_tested_sections": sum(1 for r in policy_rows if r["kind"] == "tested"),
        "policy_vendor_affirmed_sections": sum(
            1 for r in policy_rows if r["kind"] == "vendor_affirmed"
        ),
        "coverage_rows": len(coverage_rows),
        "validated_targets": export.target_count(validated_rows),
        "validated_software_targets": export.target_count(software_validated),
        "with_in_process_targets": export.target_count(with_in_process),
        "coverage_by_source": export.coverage_counts(coverage_rows),
    }
    export.write_metadata(
        out_dir / "metadata.json",
        counts,
        data_as_of,
        extra={
            "pqc_algorithms": [
                f"{family} {op}" for family, op in cavp.PQC_ALGORITHMS.values()
            ],
            "excluded_non_active_cmvp": excluded,
            "include_historical": bool(args.include_historical),
            "notes": [
                "CMVP certificate pages do not list operating environments; they "
                "are inherited from the linked CAVP validations.",
                "Modules-in-process and IUT lists carry no algorithms; PQC evidence "
                "is inferred from vendor/name matching and must be treated as "
                "indicative (see pqc_evidence).",
                "OS family, product, version and CPU architecture are normalized "
                "heuristically from CAVP operating-environment text.",
                "Security policy PDFs are extracted best-effort: the raw tested and "
                "vendor-affirmed OE sections are authoritative, while the OS/CPU "
                "candidate columns are regex hints, not compliance evidence.",
            ],
        },
    )

    log("")
    log(f"cavp validations: {len(cavp_rows)}")
    log(f"cavp OEs: {len(oe_rows)}")
    log(f"cmvp PQC certificates: {len(cmvp_rows)} ({excluded} non-active excluded)")
    log(f"in-process rows: {len(in_process_rows)} "
        f"({counts['cmvp_in_process_matched']} matched to CAVP)")
    log(f"coverage rows: {len(coverage_rows)}")
    log(f"policy sections: {len(policy_rows)} "
        f"({counts['policy_vendor_affirmed_sections']} vendor-affirmed)")
    log(f"targets validated / with in-process: "
        f"{counts['validated_targets']} / {counts['with_in_process_targets']}")
    unknown = [row for row in oe_rows if row["os_family"] == "unknown"]
    if unknown:
        log(f"os_family unknown: {len(unknown)} OEs, e.g. "
            + " | ".join(unique(row["software"] for row in unknown)[:10]))
    log(f"wrote CSVs to {out_dir}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="nist-pqc")
    sub = parser.add_subparsers(dest="command", required=True)

    scrape_parser = sub.add_parser("scrape", help="scrape NIST and write data/*.csv")
    scrape_parser.add_argument("--out", default="data", help="output directory")
    scrape_parser.add_argument("--cache-dir", default=".cache")
    scrape_parser.add_argument("--delay", type=float, default=1.0,
                               help="seconds between uncached requests")
    scrape_parser.add_argument("--workers", type=int, default=1,
                               help="parallel request workers (keep low to stay polite)")
    scrape_parser.add_argument("--no-policies", action="store_true",
                               help="skip CMVP security policy PDF extraction")
    scrape_parser.add_argument("--refresh", action="store_true",
                               help="ignore cached pages")
    scrape_parser.add_argument("--max-age-days", type=float, default=7,
                               help="refetch cached pages older than this")
    scrape_parser.add_argument("--include-historical", action="store_true",
                               help="include non-active CMVP certificates")
    scrape_parser.add_argument("--limit", type=int, default=0,
                               help="debug: only fetch the first N CAVP/CMVP records")
    scrape_parser.add_argument("--verbose-matches", action="store_true")
    scrape_parser.add_argument("--quiet", action="store_true")
    scrape_parser.set_defaults(func=scrape)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
