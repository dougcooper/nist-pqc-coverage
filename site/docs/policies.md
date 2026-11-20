---
title: Tested configurations
---

# Tested configurations

CMVP certificate pages do not list operating environments. The authoritative
list is in each non-proprietary security policy PDF, usually as a
*Tested Operational Environments* table and a *Vendor-Affirmed Operational
Environments* section. Both are extracted here as text.

The text below is the source of truth. The dashboard's other pages use
normalized CAVP operating environments; vendor-affirmed entries exist only in
these policies and are not part of the normalized target counts.

```js
import {dataTable} from "./components/table.js";
```

```js
const sections = FileAttachment("data/cmvp_policy_sections.csv").csv();
const certs = FileAttachment("data/cmvp_certs.csv").csv();
```

```js
const withSections = certs.map((cert) => ({
  ...cert,
  sectionCount: sections.filter((s) => s.cert === cert.cert).length,
  vendorAffirmed: sections.some(
    (s) => s.cert === cert.cert && s.kind === "vendor_affirmed" &&
      !/N\/A for this module/i.test(s.section_text)
  )
}));
const parsed = withSections.filter((d) => d.sectionCount > 0).length;
const affirmed = withSections.filter((d) => d.vendorAffirmed).length;
```

```js
html`<div class="stats">
  <div class="stat">
    <div class="value">${certs.length}</div>
    <div class="label">PQC certificates</div>
    <div class="hint">active CMVP certificates with a PQC algorithm</div>
  </div>
  <div class="stat">
    <div class="value">${parsed}</div>
    <div class="label">with OE sections</div>
    <div class="hint">policy PDF parsed to a tested or vendor-affirmed section</div>
  </div>
  <div class="stat">
    <div class="value">${affirmed}</div>
    <div class="label">vendor-affirmed OEs</div>
    <div class="hint">policies that list additional affirmed environments</div>
  </div>
</div>`
```

```js
const grouped = Array.from(d3.group(sections, (d) => d.cert), ([cert, list]) => ({
  ...certs.find((c) => c.cert === cert),
  sections: list
})).sort((a, b) => d3.ascending(a.cert, b.cert));
```

```js
html`${grouped.map((cert) => html`<section>
  <h2>${cert.cert} · ${cert.module}</h2>
  <p class="small">
    ${cert.vendor} · ${cert.module_type || "module type not stated"} ·
    <a href="${cert.security_policy_url}">security policy PDF</a>
  </p>
  ${cert.sections.map((section) => html`<div>
    <h3>${section.kind === "tested" ? "Tested operational environments" : "Vendor-affirmed operational environments"}${section.embodiment ? ` \u2014 ${section.embodiment}` : ""}</h3>
    <p class="small">page ${section.page}
      ${section.os_candidates ? ` · OS hints: ${section.os_candidates}` : ""}
      ${section.cpu_candidates ? ` · CPU hints: ${section.cpu_candidates}` : ""}
    </p>
    <pre class="small" style="white-space: pre-wrap; overflow-x: auto">${section.section_text}</pre>
  </div>`)}
</section>`)}`
```

```js
display(
  dataTable(withSections, {
    columns: [
      {key: "cert", label: "Cert"},
      {key: "vendor", label: "Vendor", width: 180},
      {key: "module", label: "Module", width: 240},
      {key: "module_type", label: "Type"},
      {key: "sectionCount", label: "OE sections"},
      {key: "vendorAffirmed", label: "Vendor-affirmed", format: (value) => (value ? "yes" : "no")},
      {
        key: "security_policy_url",
        label: "Policy",
        html: (row) =>
          row.security_policy_url
            ? `<a href="${String(row.security_policy_url).replace(/"/g, "&quot;")}" target="_blank" rel="noopener">PDF</a>`
            : ""
      }
    ],
    sort: "vendorAffirmed",
    reverse: true,
    pageSize: 12,
    cardTitle: "module",
    csv: "policy-certificates.csv"
  })
);
```
