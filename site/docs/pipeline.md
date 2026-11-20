---
title: Pipeline
---

# Validation pipeline

**CMVP in progress** is the modules-in-process (MIP) and implementation-under-test
(IUT) lists. Those entries have no algorithms or operating environments on NIST's
pages, so this page shows the inference used to connect them to PQC CAVP
validations, and the CAVP implementations that do not yet have an active CMVP
certificate.

```js
import {num} from "./components/common.js";
import {openDb, query} from "./components/db.js";
import {barChart, palette} from "./components/echarts.js";
import {dataTable} from "./components/table.js";
```

```js
const db = await openDb({
  coverage_raw: FileAttachment("data/pqc_coverage.parquet"),
  in_process: FileAttachment("data/cmvp_in_process.parquet"),
  cavp: FileAttachment("data/cavp_validations.parquet")
});
```

```js
const evidenceLabel = {
  cavp_name_match: "Matched to CAVP",
  name_keyword: "PQC in module name",
  cavp_vendor_only: "Vendor only",
  none: "No evidence"
};

const [counts] = await query(db, `
  SELECT count(*) FILTER (WHERE list = 'MIP') AS mip,
         count(*) FILTER (WHERE list = 'IUT') AS iut,
         count(*) FILTER (WHERE pqc_evidence = 'cavp_name_match') AS matched
  FROM in_process`);

const [noCmvpCount] = await query(db, `
  SELECT count(*) AS n FROM cavp WHERE cmvp_status = 'none_yet'`);
```

```js
html`<div class="stats">
  <div class="stat">
    <div class="value">${num.format(counts.mip)}</div>
    <div class="label">modules in process</div>
    <div class="hint">NIST Modules In Process list</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(counts.iut)}</div>
    <div class="label">implementations under test</div>
    <div class="hint">NIST IUT list</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(counts.matched)}</div>
    <div class="label">PQC matches</div>
    <div class="hint">name + vendor matched to a PQC CAVP cert</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(noCmvpCount.n)}</div>
    <div class="label">CAVP without CMVP</div>
    <div class="hint">validated PQC implementations, no active certificate</div>
  </div>
</div>`
```

<div class="note">
  In-process rows have no algorithm data. A row is counted as a PQC match only
  when its vendor matches and at least half of the meaningful module-name tokens
  appear in a PQC CAVP implementation name. <strong>PQC in module name</strong>
  and <strong>vendor only</strong> rows are leads, not confirmed PQC modules.
</div>

## Inference evidence

```js
const evidenceCounts = await query(db, `
  SELECT pqc_evidence, count(*) AS count
  FROM in_process
  GROUP BY 1`);

const evidenceRows = Object.keys(evidenceLabel).map((evidence) => ({
  evidence: evidenceLabel[evidence],
  count: evidenceCounts.find((d) => d.pqc_evidence === evidence)?.count ?? 0
}));
```

```js
display(
  barChart(evidenceRows, {
    x: "evidence",
    y: "count",
    horizontal: true,
    labels: true,
    height: 200,
    colors: [palette[0]]
  })
);
```

## In-process modules

```js
const list = view(Inputs.select(["All lists", "MIP", "IUT"], {label: "List", value: "All lists"}));
const evidence = view(
  Inputs.select(["All evidence", ...Object.keys(evidenceLabel)], {
    label: "Evidence",
    value: "All evidence",
    format: (v) => evidenceLabel[v] ?? v
  })
);
```

```js
const where = (() => {
  const clauses = [];
  const params = [];
  if (list !== "All lists") { clauses.push("list = ?"); params.push(list); }
  if (evidence !== "All evidence") { clauses.push("pqc_evidence = ?"); params.push(evidence); }
  return {sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params};
})();

const pipelineRows = await query(db, `
  SELECT module, vendor, list, status,
         strftime(status_date, '%Y-%m-%d') AS status_date,
         pqc_evidence, match_score AS score,
         matched_cavp_certs AS matched, url
  FROM in_process ${where.sql}
  ORDER BY vendor`, where.params);
```

```js
html`<div class="small">${num.format(pipelineRows.length)} rows</div>`
```

```js
const evidenceBadge = {
  cavp_name_match: "match",
  name_keyword: "keyword",
  cavp_vendor_only: "weak",
  none: "none"
};
display(
  dataTable(pipelineRows, {
    columns: [
      {key: "module", label: "Module", width: 260},
      {key: "vendor", label: "Vendor", width: 180},
      {key: "list", label: "List"},
      {key: "status", label: "Status"},
      {key: "status_date", label: "Status date"},
      {
        key: "pqc_evidence",
        label: "Evidence",
        format: (value) => evidenceLabel[value] ?? value,
        badge: (value) => evidenceBadge[value] ?? "none"
      },
      {key: "score", label: "Score", hideOnCard: true},
      {key: "matched", label: "Matched CAVP certs", hideOnCard: true},
      {
        key: "url",
        label: "NIST",
        html: (row) =>
          row.url
            ? `<a href="${String(row.url).replace(/"/g, "&quot;")}" target="_blank" rel="noopener">module</a>`
            : ""
      }
    ],
    sort: "vendor",
    pageSize: 12,
    cardTitle: "module",
    csv: "in-process-modules.csv"
  })
);
```

## Validated PQC CAVP implementations without an active CMVP certificate

These are validated algorithms you can use today, but the implementation has not
completed a CMVP module certificate (or the certificate is not active).

```js
const noCmvpRows = await query(db, `
  SELECT cert, vendor, implementation, pqc_families AS families,
         strftime(first_validated, '%Y-%m-%d') AS validated,
         in_process_modules AS pipeline, url
  FROM cavp
  WHERE cmvp_status = 'none_yet'
  ORDER BY vendor`);
```

```js
display(
  dataTable(noCmvpRows, {
    columns: [
      {key: "cert", label: "CAVP cert"},
      {key: "vendor", label: "Vendor", width: 180},
      {key: "implementation", label: "Implementation", width: 240},
      {key: "families", label: "Families"},
      {key: "validated", label: "First validated"},
      {key: "pipeline", label: "In-process match", hideOnCard: true},
      {
        key: "url",
        label: "NIST",
        html: (row) =>
          row.url
            ? `<a href="${String(row.url).replace(/"/g, "&quot;")}" target="_blank" rel="noopener">validation</a>`
            : ""
      }
    ],
    sort: "vendor",
    pageSize: 12,
    cardTitle: "implementation",
    csv: "cavp-without-cmvp.csv"
  })
);
```

```js
import {mountAgent} from "./components/ask.js";
```

```js
await mountAgent({db, source: FileAttachment("data/llm-worker.worker")});
```
