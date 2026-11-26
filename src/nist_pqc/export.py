"""CSV writers and coverage analysis."""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path


def to_iso(value: str) -> str:
    value = (value or "").strip()
    try:
        return datetime.strptime(value, "%m/%d/%Y").date().isoformat()
    except ValueError:
        return value


def write_csv(path: Path, rows: list[dict], columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=columns, extrasaction="ignore", lineterminator="\n"
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def _product_key(row: dict) -> tuple[str, str, str]:
    return (row["vendor"], row["product"], row["record_id"])


def _targets(rows: list[dict]) -> dict[tuple[str, str], dict]:
    targets: dict[tuple[str, str], dict] = {}
    for row in rows:
        if row["arch"] in ("", "unknown"):
            # Without an architecture the target is not something a customer runs.
            continue
        key = (row["os_name"], row["arch"])
        entry = targets.setdefault(
            key,
            {
                "os_name": row["os_name"],
                "arch": row["arch"],
                "os_family": row["os_family"],
                "vendors": set(),
                "products": set(),
                "certs": set(),
            },
        )
        entry["vendors"].add(row["vendor"])
        entry["products"].add(_product_key(row))
        entry["certs"].add(row["record_id"])
    return targets


def target_count(rows: list[dict]) -> int:
    """Number of usable OS/CPU targets (drops rows without an architecture)."""
    return len(_targets(rows))


def coverage_targets(rows: list[dict], variant: str) -> list[dict]:
    targets = _targets(rows)
    ordered = sorted(
        targets.values(),
        key=lambda t: (-len(t["vendors"]), -len(t["products"]), t["os_name"], t["arch"]),
    )
    universe: set[tuple[str, str, str]] = set()
    for target in targets.values():
        universe |= target["products"]
    total_vendors = len({product[0] for product in universe})
    total_products = len(universe)

    out: list[dict] = []
    seen_products: set[tuple[str, str, str]] = set()
    seen_vendors: set[str] = set()
    for rank, target in enumerate(ordered, start=1):
        seen_products |= target["products"]
        seen_vendors |= target["vendors"]
        out.append(
            {
                "variant": variant,
                "rank": rank,
                "target": (
                    f"{target['os_name']} / {target['arch']}"
                    if target["os_name"]
                    else target["arch"]
                ),
                "os_name": target["os_name"],
                "arch": target["arch"],
                "os_family": target["os_family"],
                "vendors": len(target["vendors"]),
                "products": len(target["products"]),
                "certs": len(target["certs"]),
                "pct_products": round(100 * len(target["products"]) / max(1, total_products), 1),
                "cumulative_products": len(seen_products),
                "cumulative_pct_products": round(
                    100 * len(seen_products) / max(1, total_products), 1
                ),
                "cumulative_vendors": len(seen_vendors),
                "cumulative_pct_vendors": round(
                    100 * len(seen_vendors) / max(1, total_vendors), 1
                ),
            }
        )
    return out


def coverage_greedy(rows: list[dict], variant: str) -> list[dict]:
    """Greedy set cover: which products cover the most OS/CPU targets."""
    by_product: dict[tuple[str, str, str], dict] = {}
    for row in rows:
        if row["arch"] in ("", "unknown"):
            continue
        key = _product_key(row)
        entry = by_product.setdefault(
            key,
            {
                "vendor": row["vendor"],
                "product": row["product"],
                "record_id": row["record_id"],
                "targets": set(),
            },
        )
        entry["targets"].add((row["os_name"], row["arch"]))

    universe: set[tuple[str, str]] = set()
    for entry in by_product.values():
        universe |= entry["targets"]

    uncovered = set(universe)
    out: list[dict] = []
    while uncovered:
        best_key, best = max(
            by_product.items(),
            key=lambda item: (
                len(item[1]["targets"] & uncovered),
                len(item[1]["targets"]),
                item[1]["vendor"],
                item[1]["product"],
            ),
        )
        newly = best["targets"] & uncovered
        if not newly:  # cannot happen while uncovered is non-empty
            break
        uncovered -= newly
        out.append(
            {
                "variant": variant,
                "rank": len(out) + 1,
                "vendor": best["vendor"],
                "product": best["product"],
                "record_id": best["record_id"],
                "targets_covered": len(newly),
                "targets_total": len(best["targets"]),
                "cumulative_targets": len(universe) - len(uncovered),
                "pct_targets": round(100 * (len(universe) - len(uncovered)) / max(1, len(universe)), 1),
                "universe_targets": len(universe),
            }
        )
        del by_product[best_key]
    return out


def write_metadata(
    path: Path,
    counts: dict[str, int],
    data_as_of: str,
    extra: dict | None = None,
) -> None:
    payload = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "data_as_of": data_as_of or date.today().isoformat(),
        "counts": counts,
        "nist": {
            "cavp_search": "https://csrc.nist.gov/projects/cryptographic-algorithm-validation-program/validation-search",
            "cmvp_search": "https://csrc.nist.gov/projects/cryptographic-module-validation-program/validated-modules/search/all",
            "cmvp_mip": "https://csrc.nist.gov/projects/cryptographic-module-validation-program/modules-in-process/modules-in-process-list",
            "cmvp_iut": "https://csrc.nist.gov/projects/cryptographic-module-validation-program/modules-in-process/iut-list",
            "esv_search": "https://csrc.nist.gov/projects/cryptographic-module-validation-program/entropy-validations/search",
        },
    }
    if extra:
        payload.update(extra)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def coverage_counts(rows: list[dict]) -> dict[str, int]:
    counts = defaultdict(int)
    for row in rows:
        counts[row["source"]] += 1
    return dict(counts)
