---
title: Overview
---

# NIST post-quantum validation coverage

Validated post-quantum implementations and the operating environments they run
on, drawn from the NIST CAVP and CMVP databases. Use the other pages to see
targets, coverage curves, and the validation pipeline.

```js
import {num, familyColors} from "./components/common.js";
import {openDb, query} from "./components/db.js";
import {barChart, palette} from "./components/echarts.js";
import {dataTable} from "./components/table.js";
```

```js
const db = await openDb({
  coverage_raw: FileAttachment("data/pqc_coverage.parquet"),
  cavp: FileAttachment("data/cavp_validations.parquet"),
  in_process: FileAttachment("data/cmvp_in_process.parquet")
});
const meta = FileAttachment("data/metadata.json").json();
```

```js
const [stats] = await query(db, `
  SELECT
    (SELECT count(*) FROM cavp) AS cavp,
    count(DISTINCT CASE WHEN source = 'CMVP' THEN record_id END) AS cmvp,
    count(DISTINCT CASE WHEN source = 'CMVP' AND module_kind IN ('software', 'software_hybrid')
                        THEN record_id END) AS cmvp_software,
    (SELECT count(*) FROM in_process) AS in_progress,
    (SELECT count(DISTINCT module || '|' || vendor) FROM in_process) AS in_progress_modules,
    count(DISTINCT CASE WHEN arch NOT IN ('', 'unknown') THEN target_key END) AS targets,
    count(DISTINCT vendor) AS vendors
  FROM coverage`);
```

```js
html`<div class="stats">
  <div class="stat">
    <div class="value">${num.format(stats.cavp)}</div>
    <div class="label">CAVP</div>
    <div class="hint">PQC algorithm validations</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(stats.cmvp)}</div>
    <div class="label">CMVP</div>
    <div class="hint">active certificates, ${num.format(stats.cmvp_software)} of them software</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(stats.in_progress)}</div>
    <div class="label">CMVP in progress</div>
    <div class="hint">${num.format(stats.in_progress_modules)} modules in MIP and IUT</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(stats.targets)}</div>
    <div class="label">OS / CPU targets</div>
    <div class="hint">including CMVP in progress</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(stats.vendors)}</div>
    <div class="label">vendors</div>
    <div class="hint">across the three programs</div>
  </div>
</div>`
```

```js
html`<div class="note">
  Data as of <strong>${meta.data_as_of}</strong>, generated ${meta.generated_at.slice(0, 10)}.
  PQC scope: ${meta.pqc_algorithms.join(", ")}.
  Separately, ${num.format(meta.counts.esv_certificates)} entropy sources are validated under ESV
  (${num.format(meta.counts.esv_open_for_reuse)} open for reuse) —
  see <a href="entropy">Entropy sources</a>.
</div>`
```

## Coverage by algorithm family

```js
const familyRows = await query(db, `
  SELECT pqc_family AS family, count(DISTINCT product_key) AS count
  FROM validated
  GROUP BY 1
  ORDER BY 2 DESC`);
```

```js
display(
  barChart(familyRows, {
    x: "family",
    y: "count",
    horizontal: true,
    labels: true,
    colorBy: "family",
    colors: (family) => familyColors.get(family) ?? palette[0],
    height: 200
  })
);
```

<div class="small">
  Distinct modules per family. A CAVP validation already covered by a CMVP
  certificate is not counted twice.
</div>

## Implementation languages

NIST publishes no structured implementation-language field. This counts
distinct validated software products where the language is stated in the module
description, identified by the product name, or known from the upstream
library; the remainder is unknown. Hardware and firmware are excluded because
NIST does not publish their implementation language.

```js
const languageRows = await query(db, `
  SELECT impl_language_label AS language,
         impl_language_source AS source,
         count(DISTINCT product_key) AS count
  FROM validated
  WHERE impl_language_source <> 'not_applicable'
  GROUP BY 1, 2
  ORDER BY count DESC, language`);
```

```js
const languageSourceColors = new Map([
  ["stated", palette[2]],
  ["name", palette[1]],
  ["upstream", palette[0]],
  ["none", palette[9]]
]);
display(
  barChart(languageRows, {
    x: "language",
    y: "count",
    series: "source",
    stack: true,
    horizontal: true,
    colors: languageSourceColors,
    height: 260
  })
);
```

<div class="small">
  Stacked by evidence: <strong>stated</strong> means the NIST description says
  so (for example "implemented in pure Java"); <strong>name</strong> means the
  product name identifies it; <strong>upstream</strong> means a known library
  such as OpenSSL or AWS-LC; <strong>none</strong> is the honest remainder for
  software. Hardware and firmware are left out of this chart.
  "C language API" is an interface, not an implementation, and is not counted.
</div>

## Targets by validation stage

Each OS / CPU target counted once, at its furthest stage.

```js
const stageRows = await query(db, `
  WITH per_target AS (
    SELECT target_key,
           max(CASE WHEN program = 'CMVP' THEN 2
                    WHEN program = 'CMVP in progress' THEN 1
                    ELSE 0 END) AS level
    FROM coverage
    WHERE arch NOT IN ('', 'unknown')
    GROUP BY 1
  )
  SELECT CASE level WHEN 2 THEN 'CMVP'
                    WHEN 1 THEN 'CMVP in progress'
                    ELSE 'CAVP only' END AS stage,
         count(*) AS count
  FROM per_target
  GROUP BY 1
  ORDER BY min(level)`);
```

```js
const stageColors = new Map([
  ["CAVP only", palette[0]],
  ["CMVP in progress", palette[3]],
  ["CMVP", palette[2]]
]);
display(
  barChart(stageRows, {
    x: "stage",
    y: "count",
    horizontal: true,
    labels: true,
    colorBy: "stage",
    colors: (stage) => stageColors.get(stage) ?? palette[0],
    height: 160
  })
);
```

<div class="small">
  <strong>CAVP only</strong>: no CMVP certificate or in-progress module reports the
  target. <strong>CMVP in progress</strong>: a module on that target is in the MIP or
  IUT list. <strong>CMVP</strong>: at least one active certificate covers it. The three
  bars add up to the number of targets. A target is an OS version and architecture
  pair after normalization; bare-metal environments with no OS count by architecture.
</div>

## Validations over time

```js
const timeline = await query(db, `
  SELECT strftime(first_validated, '%Y') || ' Q' ||
           CAST(1 + (month(first_validated) - 1) / 3 AS INTEGER) AS quarter,
         trim(f.family) AS family,
         count(*) AS count
  FROM cavp, unnest(string_split(pqc_families, ';')) AS f(family)
  WHERE first_validated IS NOT NULL AND trim(f.family) <> ''
  GROUP BY 1, 2
  ORDER BY 1`);
```

```js
display(
  barChart(timeline, {
    x: "quarter",
    y: "count",
    series: "family",
    stack: true,
    colors: (family) => familyColors.get(family) ?? palette[0],
    height: 300,
    rotate: -45
  })
);
```

## Top vendors

```js
const vendorRows = await query(db, `
  SELECT vendor,
         count(DISTINCT product_key) AS products,
         count(DISTINCT CASE WHEN arch NOT IN ('', 'unknown') THEN target_key END) AS targets,
         string_agg(DISTINCT pqc_family, ', ' ORDER BY pqc_family) AS families
  FROM validated
  GROUP BY vendor
  ORDER BY products DESC
  LIMIT 25`);
```

```js
display(
  dataTable(vendorRows, {
    columns: [
      {key: "vendor", label: "Vendor"},
      {key: "products", label: "Products"},
      {key: "targets", label: "Targets"},
      {key: "families", label: "Families"}
    ],
    sort: "products",
    reverse: true,
    pageSize: 10,
    csv: "vendors.csv"
  })
);
```

## Upstream libraries

```js
const upstreamRows = await query(db, `
  WITH k AS (
    SELECT coalesce(nullif(upstream, ''), 'Not classified') AS library,
           source || '|' || record_id || '|' || coalesce(vendor, '') || '|' || coalesce(product, '') AS product_key,
           source IN ('CMVP-MIP', 'CMVP-IUT') AS in_progress,
           CASE WHEN coalesce(os_name, '') <> '' THEN os_name || ' / ' || arch ELSE arch END AS target_key
    FROM coverage
    WHERE arch NOT IN ('', 'unknown')
      AND (source IN ('CMVP', 'CMVP-MIP', 'CMVP-IUT') OR (source = 'CAVP' AND status = 'none_yet'))
  )
  SELECT library,
         count(DISTINCT product_key) FILTER (WHERE NOT in_progress) AS validated,
         count(DISTINCT product_key) FILTER (WHERE in_progress) AS in_progress,
         count(DISTINCT target_key) FILTER (WHERE NOT in_progress) AS targets
  FROM k
  GROUP BY 1
  ORDER BY library = 'Not classified', validated DESC, in_progress DESC`);
```

```js
display(
  dataTable(upstreamRows, {
    columns: [
      {key: "library", label: "Library"},
      {key: "validated", label: "Validated modules"},
      {key: "in_progress", label: "In progress"},
      {key: "targets", label: "Targets"}
    ],
    pageSize: 10,
    csv: "upstream-libraries.csv"
  })
);
```

<div class="small">
  A keyword match on each module's name, so a rebrand collapses to the library it
  embeds (Ciena's modem to wolfSSL). NIST does not publish component dependencies,
  and most module names do not mention one: <strong>Not classified</strong> is the
  honest remainder, not a gap in the data. Validated counts active CMVP certificates
  plus CAVP validations without one; in progress covers the MIP and IUT lists.
</div>

```js
import {mountAgent} from "./components/ask.js";
```

```js
await mountAgent({db, source: FileAttachment("data/llm-worker.worker")});
```
