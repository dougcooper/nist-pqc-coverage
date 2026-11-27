---
title: Entropy sources
---

# Entropy sources

<p class="entropy-wide">
Which chipset families already have a validated entropy source? This view
groups the CMVP Entropy Source Validation (ESV) certificates by the platform
families named in their operating environments, then narrows to the
certificates that are both <strong>open for reuse</strong> and a
<strong>physical</strong> noise source. That combination is the part of a
platform a new FIPS 140-3 module does not have to re-validate.
</p>

<p class="entropy-wide">
The list covers embedded chipsets, server and PC processors, and security
chips — not just MCUs and SoCs. The full register of approved entropy-source
certificates is at the bottom of this page.
</p>

<div class="note entropy-wide">
  This is a discovery aid, not a NIST mapping. ESV certificates validate
  SP 800-90B entropy sources, not FIPS 140-3 modules, and NIST does not publish
  which modules reference an ESV certificate. Platform families are a curated
  regex match over vendor-declared operating-environment text. Verify the chip,
  the exact source variant, and the vendor's reuse terms before relying on one.
  SSD, HDD, and optical-controller subsystems are intentionally left in
  Unmapped: they do not identify a reusable platform family in the same way as
  a CPU, SoC, or security chip.
</div>

```js
import {platformShortlist} from "./components/platforms.js";
import {num} from "./components/common.js";
import {openDb, query} from "./components/db.js";
import {dataTable} from "./components/table.js";
```

```js
const meta = await FileAttachment("data/metadata.json").json();
const families = await FileAttachment("data/platform_families.csv").csv();
const certs = await FileAttachment("data/platform_family_certs.csv").csv();
const unmapped = await FileAttachment("data/platform_unmapped_certs.csv").csv();
const familyFile = FileAttachment("data/platform_families.csv");
const certFile = FileAttachment("data/platform_family_certs.csv");
const unmappedFile = FileAttachment("data/platform_unmapped_certs.csv");
const db = await openDb({esv: FileAttachment("data/esv_certs.parquet")});
const sourceFile = FileAttachment("data/esv_certs.csv");
```

```js
display(platformShortlist({
  families,
  certs,
  unmapped,
  totalEsv: meta.counts.esv_certificates
}));
```

```js
display(html`<div class="small entropy-wide">
  ${num.format(meta.counts.platform_mapped_certificates)} of
  ${num.format(meta.counts.esv_certificates)} ESV certificates map to
  ${num.format(meta.counts.platform_families)} families, producing
  ${num.format(meta.counts.platform_cert_matches)} family-certificate matches.
  ${num.format(meta.counts.platform_unmapped_certificates)} certificates match no
  family and are listed under
  <a href="#unmapped">Unmapped certificates</a>.
  Download the
  <a href="${familyFile.href}" download="${familyFile.name}">family summary CSV</a>,
  the
  <a href="${certFile.href}" download="${certFile.name}">family-certificate matches CSV</a>,
  or the
  <a href="${unmappedFile.href}" download="${unmappedFile.name}">unmapped certificates CSV</a>.
  The full ESV register is below; the
  <a href="explorer">full dataset downloads</a>
  are also available.
</div>`);
```

## Entropy source certificates

<p class="entropy-wide">
The full ESV register. Filter by reuse status or noise source; open **Details**
for the complete certificate record.
</p>

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
html`<div class="small entropy-wide">
  ${num.format(rows.length)} of ${num.format(meta.counts.esv_certificates)} certificates in this filter ·
  <a href="${sourceFile.href}" download="${sourceFile.name}">download esv_certs.csv</a>
</div>`
```

```js
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"]/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  })[c]);

const shorten = (value, max = 90) => {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

const environmentsCell = (value) => {
  const environments = String(value ?? "")
    .split(";")
    .map((environment) => environment.trim())
    .filter(Boolean);
  if (!environments.length) return "";
  if (environments.length === 1) {
    return `<span class="esv-env-single" title="${escapeHtml(environments[0])}">${escapeHtml(shorten(environments[0]))}</span>`;
  }
  return `<details class="esv-envs">
    <summary>
      <span class="esv-env-count">${environments.length}</span>
      <span class="esv-env-first" title="${escapeHtml(environments[0])}">${escapeHtml(shorten(environments[0], 55))}</span>
    </summary>
    <ul>${environments.map((environment) => `<li>${escapeHtml(environment)}</li>`).join("")}</ul>
  </details>`;
};

const statusCell = (row) => {
  const parts = [];
  const reuse = String(row.reuse_status ?? "");
  if (reuse) {
    const open = reuse === "Open for Reuse";
    parts.push(`<span class="badge ${open ? "open" : "restricted"}" title="${escapeHtml(reuse)}">${open ? "Open" : "Restricted"}</span>`);
  }
  if (row.noise_source) {
    parts.push(`<span class="badge" title="${escapeHtml(row.noise_source)}">${escapeHtml(row.noise_source)}</span>`);
  }
  return parts.length ? `<div class="esv-status">${parts.join("")}</div>` : "";
};

const esvByCert = new Map(rows.map((row) => [row.cert, row]));

const detailsButton = (row) =>
  `<button type="button" class="esv-details-open" data-cert="${escapeHtml(row.cert)}">Details</button>`;

const dialog = document.querySelector("dialog.esv-dialog") ?? document.createElement("dialog");
dialog.className = "esv-dialog";

const openDetails = (cert) => {
  const row = esvByCert.get(cert);
  if (!row) return;

  const environments = String(row.operating_environments ?? "")
    .split(";")
    .map((environment) => environment.trim())
    .filter(Boolean);
  const links = [];
  if (row.url) {
    links.push(`<a href="${escapeHtml(row.url)}" target="_blank" rel="noopener">NIST certificate</a>`);
  }
  if (row.public_use_document_url) {
    links.push(`<a href="${escapeHtml(row.public_use_document_url)}" target="_blank" rel="noopener">Public use document</a>`);
  }
  if (row.vendor_url) {
    links.push(`<a href="${escapeHtml(row.vendor_url)}" target="_blank" rel="noopener">Vendor website</a>`);
  }

  const fields = [
    ["Vendor", row.vendor ? escapeHtml(row.vendor) : ""],
    ["Status", statusCell(row)],
    ["Entropy / output", row.entropy ? escapeHtml(row.entropy) : ""],
    ["Validated", row.validated ? escapeHtml(row.validated) : ""],
    ["Standard", row.standard ? escapeHtml(row.standard) : ""],
    ["Version", row.version ? escapeHtml(row.version) : ""],
    ["Conditioning CAVP", row.conditioning_cavp_certs ? escapeHtml(row.conditioning_cavp_certs) : ""],
    ["Lab", row.lab ? escapeHtml(row.lab) : ""],
    ["Links", links.join(" · ")]
  ].filter(([, value]) => value);

  dialog.innerHTML = `<div class="esv-dialog-body">
    <form method="dialog" class="esv-dialog-close-form">
      <button type="submit" class="esv-dialog-close" aria-label="Close">×</button>
    </form>
    <p class="eyebrow">ESV certificate</p>
    <h2>${row.url ? `<a href="${escapeHtml(row.url)}" target="_blank" rel="noopener">${escapeHtml(row.cert)}</a>` : escapeHtml(row.cert)}</h2>
    <p class="esv-dialog-title">${escapeHtml(row.implementation)}</p>
    <dl>${fields.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("")}</dl>
    ${row.description ? `<h3>Description</h3><p>${escapeHtml(row.description)}</p>` : ""}
    ${environments.length ? `<h3>Operating environments</h3><ul class="esv-dialog-envs">${environments.map((environment) => `<li>${escapeHtml(environment)}</li>`).join("")}</ul>` : ""}
  </div>`;

  if (!dialog.isConnected) document.body.append(dialog);
  if (dialog.open) dialog.close();
  dialog.showModal();
};

const detailsHandler = (event) => {
  const button = event.target.closest?.(".esv-details-open");
  if (!button) return;
  openDetails(button.dataset.cert);
};
if (window.__esvDetailsHandler) {
  document.removeEventListener("click", window.__esvDetailsHandler);
}
window.__esvDetailsHandler = detailsHandler;
document.addEventListener("click", detailsHandler);

const csvKeys = [
  "cert", "implementation", "vendor", "standard", "description", "version",
  "noise_source", "reuse_status", "bits_per_output", "output_size_bits",
  "operating_environments", "conditioning_cavp_certs", "validated", "lab",
  "public_use_document_url", "vendor_url", "url"
];

display(
  dataTable(rows, {
    columns: [
      {
        key: "cert",
        label: "Certificate",
        width: 68,
        html: (row) => {
          const certificate = row.url
            ? `<a href="${escapeHtml(row.url)}" target="_blank" rel="noopener">${escapeHtml(row.cert)}</a>`
            : escapeHtml(row.cert);
          const validated = row.validated
            ? `<span class="esv-sub">${escapeHtml(row.validated)}</span>`
            : "";
          return certificate + validated;
        }
      },
      {
        key: "implementation",
        label: "Entropy source",
        width: 160,
        html: (row) =>
          escapeHtml(row.implementation) +
          (row.vendor ? `<span class="esv-sub">${escapeHtml(row.vendor)}</span>` : "")
      },
      {key: "vendor", label: "Vendor", hideOnTable: true},
      {key: "reuse_status", label: "Status", width: 92, html: statusCell},
      {key: "entropy", label: "Entropy / output", width: 88},
      {
        key: "operating_environments",
        label: "Operating environments",
        width: 170,
        html: (row) => environmentsCell(row.operating_environments)
      },
      {
        key: "details",
        label: "Details",
        width: 52,
        html: detailsButton,
        sortable: false
      }
    ],
    searchKeys: csvKeys,
    csvKeys,
    pageSize: 20,
    cardTitle: "implementation",
    csv: "esv-entropy-sources-filtered.csv"
  })
);
```

<div class="note small entropy-wide">
  Rows are the certificates' current published fields. Operating environments
  expand in place; <strong>Details</strong> opens the full record, including
  conditioning components, lab, and links. A certificate may list several
  operating environments and conditioning components; they are joined with
  semicolons in the CSV. <strong>Open for Reuse</strong> permits another vendor
  to reference the certificate; <strong>Reuse restricted to vendor</strong> does
  not. NIST does not publish the modules that reference each certificate, so
  this page cannot show which products use an entropy source.
</div>
