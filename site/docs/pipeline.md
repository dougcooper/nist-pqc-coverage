---
title: Pipeline
---

# Validation pipeline

Modules-in-process and IUT (implementation under test) entries have no
algorithms or operating environments on the NIST lists. This page shows the
inference used to connect them to PQC CAVP validations, and the validated PQC
implementations that do not yet have an active CMVP certificate.

```js
import {num, splitList} from "./components/common.js";
```

```js
const pipeline = FileAttachment("data/cmvp_in_process.csv").csv();
const cavp = FileAttachment("data/cavp_validations.csv").csv();
```

```js
const evidenceLabel = {
  cavp_name_match: "Matched to CAVP",
  name_keyword: "PQC in module name",
  cavp_vendor_only: "Vendor only",
  none: "No evidence"
};

const matched = pipeline.filter((d) => d.pqc_evidence === "cavp_name_match");
const keyword = pipeline.filter((d) => d.pqc_evidence === "name_keyword");
const vendorOnly = pipeline.filter((d) => d.pqc_evidence === "cavp_vendor_only");
const unmatched = pipeline.filter((d) => d.pqc_evidence === "none");
const noCmvp = cavp.filter((d) => d.cmvp_status === "none_yet");
```

```js
html`<div class="stats">
  <div class="stat">
    <div class="value">${num.format(pipeline.filter((d) => d.list === "MIP").length)}</div>
    <div class="label">modules in process</div>
    <div class="hint">NIST Modules In Process list</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(pipeline.filter((d) => d.list === "IUT").length)}</div>
    <div class="label">implementations under test</div>
    <div class="hint">NIST IUT list</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(matched.length)}</div>
    <div class="label">PQC matches</div>
    <div class="hint">name + vendor matched to a PQC CAVP cert</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(noCmvp.length)}</div>
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
const evidenceRows = Object.entries({
  cavp_name_match: matched.length,
  name_keyword: keyword.length,
  cavp_vendor_only: vendorOnly.length,
  none: unmatched.length
}).map(([evidence, count]) => ({evidence: evidenceLabel[evidence], count}));
```

```js
Plot.plot({
  height: 200,
  marginLeft: 160,
  x: {label: "modules", grid: true},
  y: {label: null},
  marks: [
    Plot.barX(evidenceRows, {x: "count", y: "evidence", fill: "#4e79a7", tip: true}),
    Plot.text(evidenceRows, {
      x: "count",
      y: "evidence",
      text: (d) => d.count,
      dx: 5,
      textAnchor: "start",
      fill: "currentColor"
    }),
    Plot.ruleX([0])
  ]
})
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
const search = view(Inputs.text({label: "Search", placeholder: "module or vendor\u2026"}));
```

```js
const pipelineRows = pipeline
  .filter((d) => (list === "All lists" || d.list === list) && (evidence === "All evidence" || d.pqc_evidence === evidence))
  .filter((d) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return `${d.module} ${d.vendor}`.toLowerCase().includes(q);
  })
  .map((d) => ({
    module: d.module,
    vendor: d.vendor,
    list: d.list,
    status: d.status,
    status_date: d.status_date,
    evidence: evidenceLabel[d.pqc_evidence] ?? d.pqc_evidence,
    score: d.match_score,
    matched: d.matched_cavp_certs,
    url: d.url
  }));
```

```js
html`<div class="small">${num.format(pipelineRows.length)} rows</div>`
```

```js
Inputs.table(pipelineRows, {
  columns: ["module", "vendor", "list", "status", "status_date", "evidence", "score", "matched", "url"],
  header: {
    module: "Module",
    vendor: "Vendor",
    list: "List",
    status: "Status",
    status_date: "Status date",
    evidence: "Evidence",
    score: "Score",
    matched: "Matched CAVP certs",
    url: "NIST"
  },
  sort: "vendor",
  rows: 40,
  width: {module: 300, vendor: 220, matched: 140}
})
```

## Validated PQC CAVP implementations without an active CMVP certificate

These are validated algorithms you can use today, but the implementation has not
completed a CMVP module certificate (or the certificate is not active).

```js
const noCmvpRows = noCmvp.map((d) => ({
  cert: d.cert,
  vendor: d.vendor,
  implementation: d.implementation,
  families: d.pqc_families,
  validated: d.first_validated,
  pipeline: d.in_process_modules,
  url: d.url
}));
```

```js
Inputs.table(noCmvpRows, {
  columns: ["cert", "vendor", "implementation", "families", "validated", "pipeline", "url"],
  header: {
    cert: "CAVP cert",
    vendor: "Vendor",
    implementation: "Implementation",
    families: "Families",
    validated: "First validated",
    pipeline: "In-process match",
    url: "NIST"
  },
  sort: "vendor",
  rows: 30,
  width: {implementation: 340, vendor: 220, pipeline: 220}
})
```
