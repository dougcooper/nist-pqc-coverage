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

## Read the policies

```js
const mode = view(Inputs.radio(["Simple", "Expanded"], {label: "View", value: "Simple"}));
```

<div class="small">
  <strong>Simple</strong> lists the operating environments each policy names, with
  the quoted text one click away. <strong>Expanded</strong> opens every certificate
  and shows the policy text inline. Open a certificate to see its sections; open a
  section to read the extract. OS and CPU hints are matched from the text, not a
  parsed table, so treat them as a pointer into the quote.
</div>

```js
const grouped = Array.from(d3.group(sections, (d) => d.cert), ([cert, list]) => {
  const meta = certs.find((c) => c.cert === cert) ?? {};
  const ordered = list
    .slice()
    .sort((a, b) => (a.kind === "tested" ? -1 : 1) - (b.kind === "tested" ? -1 : 1));
  return {...meta, cert, sections: ordered};
}).sort((a, b) => d3.ascending(Number(a.cert), Number(b.cert)));

const chips = (text, limit, kind) => {
  const items = [...new Set(String(text ?? "").split(";").map((s) => s.trim()).filter(Boolean))];
  if (!items.length) return "";
  const shown = mode === "Expanded" ? items : items.slice(0, limit);
  const extra = items.length - shown.length;
  return html`<div class="policy-chips">
    <span class="policy-hint">${kind === "os" ? "OS" : "CPU"}</span>
    ${shown.map((item) => html`<span class="policy-chip ${kind}">${item}</span>`)}
    ${extra > 0 ? html`<span class="policy-chip more">+${extra} more in the text</span>` : ""}
  </div>`;
};

const sectionNode = (section) => {
  const title = section.kind === "tested"
    ? "Tested operational environments"
    : "Vendor-affirmed operational environments";
  const na = /N\/A for this module/i.test(section.section_text);
  if (mode === "Simple" && na) {
    return html`<div class="policy-section">
      <h3>${title}</h3>
      <p class="small muted">N/A for this module.</p>
    </div>`;
  }
  const text = section.section_text ?? "";
  return html`<div class="policy-section">
    <h3>${title}${section.embodiment ? html` <span class="policy-meta">— ${section.embodiment}</span>` : ""}</h3>
    <p class="small policy-meta">p. ${section.page}</p>
    ${section.os_candidates ? chips(section.os_candidates, 12, "os") : ""}
    ${section.cpu_candidates ? chips(section.cpu_candidates, 8, "cpu") : ""}
    ${mode === "Expanded"
      ? html`<pre class="policy-pre">${text}</pre>`
      : html`<details class="policy-text">
          <summary>Show the quoted text · ${text.length.toLocaleString()} characters</summary>
          <pre class="policy-pre">${text}</pre>
        </details>`}
  </div>`;
};

const list = html`<div class="policy-list">${grouped.map((card) => {
  const tested = card.sections.filter((s) => s.kind === "tested").length;
  const affirmedHere = card.sections.some(
    (s) => s.kind === "vendor_affirmed" && !/N\/A for this module/i.test(s.section_text)
  );
  return html`<details class="policy-card">
    <summary>
      <span class="policy-cert">${card.cert}</span>
      <span class="policy-module">${card.module ?? "module name not stated"}</span>
      <span class="policy-meta">${card.vendor ?? ""}${card.module_type ? ` · ${card.module_type}` : ""}</span>
      <span class="policy-flags">
        ${tested ? html`<span class="policy-flag">tested</span>` : ""}
        ${affirmedHere ? html`<span class="policy-flag affirmed">vendor-affirmed</span>` : ""}
      </span>
    </summary>
    <div class="policy-body">
      <p class="small policy-meta">
        ${card.standard ?? ""}
        ${card.security_policy_url ? html` · <a href="${card.security_policy_url}" target="_blank" rel="noopener">security policy PDF</a>` : ""}
      </p>
      ${card.sections.map(sectionNode)}
    </div>
  </details>`;
})}</div>`;

for (const card of list.querySelectorAll("details.policy-card")) {
  card.open = mode === "Expanded";
}
display(list);
```

```js
display(
  html`<details class="policy-index">
    <summary>All ${certs.length} PQC certificates, including those without an extracted section</summary>
    ${dataTable(withSections, {
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
    })}
  </details>`
);
```
