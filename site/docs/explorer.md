---
title: Explorer
---

# Explorer

Every row of the flattened coverage dataset. Filter, search, and sort; links go
to the NIST source page for each record.

```js
import {num, families, sourceLabel, moduleKinds} from "./components/common.js";
import {openDb, query} from "./components/db.js";
import {dataTable} from "./components/table.js";
```

```js
const db = await openDb({coverage_raw: FileAttachment("data/pqc_coverage.parquet")});
const sourceFile = FileAttachment("data/pqc_coverage.csv");
```

```js
const sourceOptions = (await query(db, `SELECT DISTINCT source FROM coverage ORDER BY 1`)).map((d) => d.source);
const upstreamOptions = (await query(db, `
  SELECT DISTINCT upstream FROM coverage
  WHERE coalesce(upstream, '') <> '' ORDER BY 1`)).map((d) => d.upstream);
const osFamilyOptions = (await query(db, `SELECT DISTINCT os_family FROM coverage ORDER BY 1`)).map((d) => d.os_family);
const archOptions = (await query(db, `SELECT DISTINCT arch FROM coverage ORDER BY 1`)).map((d) => d.arch);
const implLanguageOptions = (await query(db, `
  SELECT DISTINCT impl_language_label FROM coverage
  ORDER BY impl_language_label`)).map((d) => d.impl_language_label);
const [total] = await query(db, `SELECT count(*) AS n FROM coverage`);
```

```js
const source = view(
  Inputs.select(["All sources", ...sourceOptions], {
    label: "Source",
    value: "All sources",
    format: (v) => sourceLabel(v)
  })
);
const family = view(Inputs.select(["All algorithms", ...families], {label: "Family", value: "All algorithms"}));
const upstream = view(
  Inputs.select(["All upstream libraries", ...upstreamOptions], {
    label: "Upstream",
    value: "All upstream libraries"
  })
);
const osFamily = view(
  Inputs.select(["All OS families", ...osFamilyOptions], {
    label: "OS family",
    value: "All OS families"
  })
);
const arch = view(
  Inputs.select(["All architectures", ...archOptions], {
    label: "Architecture",
    value: "All architectures"
  })
);
const moduleKind = view(
  Inputs.select(["All module kinds", ...moduleKinds.keys()], {
    label: "Module kind",
    value: "All module kinds"
  })
);
const implLanguage = view(
  Inputs.select(["All implementation languages", ...implLanguageOptions], {
    label: "Implementation language",
    value: "All implementation languages"
  })
);
```

```js
const where = (() => {
  const clauses = [];
  const params = [];
  if (source !== "All sources") { clauses.push("source = ?"); params.push(source); }
  if (family !== "All algorithms") { clauses.push("pqc_family = ?"); params.push(family); }
  if (upstream !== "All upstream libraries") { clauses.push("upstream = ?"); params.push(upstream); }
  if (osFamily !== "All OS families") { clauses.push("os_family = ?"); params.push(osFamily); }
  if (arch !== "All architectures") { clauses.push("arch = ?"); params.push(arch); }
  if (moduleKind !== "All module kinds") { clauses.push("module_kind = ?"); params.push(moduleKinds.get(moduleKind)); }
  if (implLanguage !== "All implementation languages") { clauses.push("impl_language_label = ?"); params.push(implLanguage); }
  return {sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params};
})();
```

```js
const rows = (await query(db, `
  SELECT source, vendor, product, module_type, upstream, impl_language_label,
         impl_language_source, status, pqc_algorithm AS algorithm,
         parameter_sets, os_family, os_name, os_version, arch, cpu, target, evidence,
         strftime(validated, '%Y-%m-%d') AS validated, url
  FROM coverage ${where.sql}`, where.params)).map((d) => ({...d, source: sourceLabel(d.source)}));
```

```js
html`<div class="small">
  ${num.format(rows.length)} of ${num.format(total.n)} rows in this filter ·
  <a href="${sourceFile.href}" download="${sourceFile.name}">download pqc_coverage.csv</a>
</div>`
```

```js
display(
  dataTable(rows, {
    columns: [
      {key: "source", label: "Source"},
      {key: "vendor", label: "Vendor", width: 160},
      {key: "product", label: "Product", width: 200},
      {key: "module_type", label: "Type"},
      {key: "upstream", label: "Upstream", hideOnCard: true},
      {key: "impl_language_label", label: "Language"},
      {key: "impl_language_source", label: "Language source", hideOnCard: true},
      {key: "status", label: "Status", hideOnCard: true},
      {key: "algorithm", label: "Algorithm"},
      {key: "parameter_sets", label: "Parameter sets", hideOnCard: true},
      {key: "os_family", label: "OS family", hideOnCard: true},
      {key: "os_name", label: "OS"},
      {key: "os_version", label: "Version", hideOnCard: true},
      {key: "arch", label: "Arch"},
      {key: "cpu", label: "CPU", hideOnCard: true},
      {key: "target", label: "Target", hideOnCard: true},
      {key: "evidence", label: "Evidence", hideOnCard: true},
      {key: "validated", label: "Validated", hideOnCard: true},
      {
        key: "url",
        label: "NIST",
        html: (row) =>
          row.url
            ? `<a href="${String(row.url).replace(/"/g, "&quot;")}" target="_blank" rel="noopener">source</a>`
            : ""
      }
    ],
    pageSize: 25,
    cardTitle: "product",
    csv: "pqc-coverage-filtered.csv"
  })
);
```

## Download the data

The same CSVs that drive these pages are committed in `data/`:

```js
const downloads = [
  [FileAttachment("data/pqc_coverage.csv"), "pqc_coverage.csv", "flat analysis table (source, product, OE, target, algorithm)"],
  [FileAttachment("data/operating_environments.csv"), "operating_environments.csv", "CAVP operating environments with normalized OS/CPU fields"],
  [FileAttachment("data/coverage_targets.csv"), "coverage_targets.csv", "targets ranked by product/vendor coverage, both scopes"],
  [FileAttachment("data/coverage_greedy.csv"), "coverage_greedy.csv", "greedy set cover: products covering the most targets"],
  [FileAttachment("data/cavp_validations.csv"), "cavp_validations.csv", "CAVP validations that include a PQC algorithm"],
  [FileAttachment("data/cavp_oe_algorithms.csv"), "cavp_oe_algorithms.csv", "operating environment × algorithm capability rows"],
  [FileAttachment("data/cmvp_certs.csv"), "cmvp_certs.csv", "active CMVP certificates with PQC algorithms"],
  [FileAttachment("data/cmvp_cavp_links.csv"), "cmvp_cavp_links.csv", "CMVP certificate → CAVP A-number links"],
  [FileAttachment("data/cmvp_in_process.csv"), "cmvp_in_process.csv", "modules in process / IUT with inferred PQC evidence"],
  [FileAttachment("data/cmvp_policy_sections.csv"), "cmvp_policy_sections.csv", "tested and vendor-affirmed OE sections from security policies"]
].map(([file, name, description]) =>
  html`<li><a href="${file.href}" download="${name}">${name}</a> — ${description}</li>`
);

display(html`<ul class="small">${downloads}</ul>`);
```

```js
display(html`<div class="note small">
  <strong>Working with an agent or a notebook?</strong>
  The same files are published at stable URLs too:
  <a href="https://dougcooper.github.io/nist-pqc-coverage/llms.txt">llms.txt</a>
  explains the three programs, the views and the caveats in plain text,
  <a href="https://dougcooper.github.io/nist-pqc-coverage/downloads/schema.json">schema.json</a>
  describes every column, and
  <a href="https://dougcooper.github.io/nist-pqc-coverage/downloads/summary.json">summary.json</a>
  holds the headline counts. Every CSV and Parquet file sits under
  <code>downloads/</code> with a name that never changes.
</div>`);
```

```js
import {mountAgent} from "./components/ask.js";
```

```js
await mountAgent({db, source: FileAttachment("data/llm-worker.worker")});
```
