---
title: Entropy sources
---

# Validated entropy sources

The CMVP Entropy Source Validation (ESV) program certifies an entropy source on
its own, separately from any module. A module can reference an ESV certificate
by number instead of validating the same noise source again. For embedded
selection this matters: an **Open for Reuse** certificate is the part of the
platform that a vendor does not have to re-certify.

<div class="note">
  ESV is not a PQC algorithm validation. These certificates cover SP 800-90B
  entropy sources only; the module still needs its own FIPS 140-3 certificate
  for the algorithms it runs. NIST does not publish which modules reference
  each ESV certificate, so the reuse status is the usable signal.
</div>

```js
import {num} from "./components/common.js";
import {openDb, query} from "./components/db.js";
import {barChart, palette} from "./components/echarts.js";
import {dataTable} from "./components/table.js";
```

```js
const db = await openDb({esv: FileAttachment("data/esv_certs.parquet")});
const sourceFile = FileAttachment("data/esv_certs.csv");
```

```js
const [counts] = await query(db, `
  SELECT count(*) AS certs,
         count(*) FILTER (WHERE reuse_status = 'Open for Reuse') AS open,
         count(*) FILTER (WHERE noise_source = 'Physical') AS physical,
         count(DISTINCT vendor) AS vendors
  FROM esv`);
```

```js
html`<div class="stats">
  <div class="stat">
    <div class="value">${num.format(counts.certs)}</div>
    <div class="label">ESV certificates</div>
    <div class="hint">completed entropy-source assessments</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(counts.open)}</div>
    <div class="label">open for reuse</div>
    <div class="hint">usable by vendors other than the certificate holder</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(counts.physical)}</div>
    <div class="label">physical noise sources</div>
    <div class="hint">hardware entropy, not a software jitter source</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(counts.vendors)}</div>
    <div class="label">vendors</div>
    <div class="hint">with at least one ESV certificate</div>
  </div>
</div>`
```

## Certificates per year

```js
const yearRows = await query(db, `
  SELECT strftime(validated, '%Y') AS year_label, count(*) AS count
  FROM esv
  WHERE validated IS NOT NULL
  GROUP BY 1
  ORDER BY 1`);
display(
  barChart(yearRows, {
    x: "year_label",
    y: "count",
    labels: true,
    colors: [palette[0]],
    height: 200
  })
);
```

## Entropy source certificates

```js
const reuseOptions = (
  await query(db, `
    SELECT DISTINCT reuse_status FROM esv
    WHERE coalesce(reuse_status, '') <> '' ORDER BY 1`)
).map((d) => d.reuse_status);
const noiseOptions = (
  await query(db, `
    SELECT DISTINCT noise_source FROM esv
    WHERE coalesce(noise_source, '') <> '' ORDER BY 1`)
).map((d) => d.noise_source);
```

```js
const reuse = view(
  Inputs.select(["All reuse statuses", ...reuseOptions], {
    label: "Reuse status",
    value: "All reuse statuses"
  })
);
const noise = view(
  Inputs.select(["All noise sources", ...noiseOptions], {
    label: "Noise source",
    value: "All noise sources"
  })
);
```

```js
const where = (() => {
  const clauses = [];
  const params = [];
  if (reuse !== "All reuse statuses") { clauses.push("reuse_status = ?"); params.push(reuse); }
  if (noise !== "All noise sources") { clauses.push("noise_source = ?"); params.push(noise); }
  return {sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params};
})();
```

```js
const rows = (await query(db, `
  SELECT cert, implementation, vendor, standard, description, version,
         noise_source, reuse_status, bits_per_output, output_size_bits,
         operating_environments, conditioning_cavp_certs,
         strftime(validated, '%Y-%m-%d') AS validated, lab,
         public_use_document_url, url
  FROM esv ${where.sql}
  ORDER BY CAST(substr(cert, 2) AS INTEGER)`, where.params)).map((row) => ({
    ...row,
    entropy: [row.bits_per_output, row.output_size_bits && `${row.output_size_bits} bits`]
      .filter(Boolean)
      .join(" · ")
  }));
```

```js
html`<div class="small">
  ${num.format(rows.length)} of ${num.format(counts.certs)} certificates in this filter ·
  <a href="${sourceFile.href}" download="${sourceFile.name}">download esv_certs.csv</a>
</div>`
```

```js
const reuseBadge = (value) => value === "Open for Reuse" ? "open" : "restricted";
display(
  dataTable(rows, {
    columns: [
      {
        key: "cert",
        label: "Certificate",
        html: (row) =>
          row.url
            ? `<a href="${String(row.url).replace(/"/g, "&quot;")}" target="_blank" rel="noopener">${row.cert}</a>`
            : row.cert
      },
      {key: "implementation", label: "Entropy source", width: 220},
      {key: "vendor", label: "Vendor", width: 150},
      {
        key: "reuse_status",
        label: "Reuse",
        badge: reuseBadge
      },
      {key: "noise_source", label: "Noise"},
      {key: "entropy", label: "Entropy / output", hideOnCard: true},
      {key: "operating_environments", label: "Operating environments", width: 260},
      {key: "conditioning_cavp_certs", label: "Conditioning CAVP", hideOnCard: true},
      {key: "validated", label: "Validated"},
      {key: "lab", label: "Lab", hideOnCard: true},
      {
        key: "public_use_document_url",
        label: "Public use",
        hideOnCard: true,
        html: (row) =>
          row.public_use_document_url
            ? `<a href="${String(row.public_use_document_url).replace(/"/g, "&quot;")}" target="_blank" rel="noopener">document</a>`
            : ""
      }
    ],
    pageSize: 20,
    cardTitle: "implementation",
    csv: "esv-entropy-sources-filtered.csv"
  })
);
```

<div class="note small">
  Rows are the certificates' current published fields. A certificate may list
  several operating environments and conditioning components; they are joined
  with semicolons in the CSV. <strong>Open for Reuse</strong> permits another
  vendor to reference the certificate; <strong>Reuse restricted to vendor</strong>
  does not. NIST does not publish the modules that reference each certificate,
  so this page cannot show which products use an entropy source.
</div>
