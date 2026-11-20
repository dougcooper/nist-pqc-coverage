// Copy the dataset to stable URLs and write the files an agent needs:
// downloads/llms.txt, downloads/schema.json, downloads/summary.json, robots.txt.
// Runs after `observable build`, because Framework content-hashes every file it
// references, which would change these URLs on every rebuild.
import {copyFile, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const site = fileURLToPath(new URL("../", import.meta.url));
const repo = fileURLToPath(new URL("../../", import.meta.url));
const dataDir = join(repo, "data");
const dist = join(site, "dist");
const out = join(dist, "downloads");

const SITE = "https://dougcooper.github.io/nist-pqc-coverage";
const DOWNLOADS = `${SITE}/downloads`;

/** One-line meaning for every column an agent is likely to use. */
const NOTES = {
  source: "Program: CAVP | CMVP | CMVP-MIP | CMVP-IUT",
  program: "CAVP | CMVP | CMVP in progress",
  record_id: "CAVP validation id (e.g. 40512) or CMVP certificate number",
  cert: "CAVP validation number (A####) or CMVP certificate number",
  vendor: "Vendor named by NIST",
  product: "CAVP Implementation Name or CMVP Module Name",
  module: "CMVP module name",
  implementation: "CAVP implementation name",
  module_type: "Type as published: SOFTWARE | HARDWARE | FIRMWARE (CMVP), or the CAVP type",
  type: "CAVP type: SOFTWARE | HARDWARE | FIRMWARE",
  upstream: "Keyword match to a known upstream library (AWS-LC, OpenSSL, Bouncy Castle, ...); empty when no match",
  status:
    "For CAVP rows: active (an active CMVP certificate covers it), in_process (matched to a CMVP module in process), none_yet. For CMVP rows: certificate status.",
  cmvp_status: "active | in_process | none_yet (CAVP rows only)",
  validated: "1 when the row is in the validated set the dashboard uses; 0 or empty otherwise",
  url: "NIST detail or certificate page",
  oe_id: "NIST operating-environment id",
  oe_name: "Raw operating-environment text from NIST",
  os_family:
    "Normalized OS family: linux, windows, macos, ios, android, freebsd, solaris, rtos, hypervisor, appliance, simulator, none (bare metal or hardware only), unknown",
  os_name: "Normalized OS name and version, e.g. 'Amazon Linux 2023'; empty for bare metal",
  os_product: "OS product without the version",
  os_version: "OS version",
  arch: "Normalized CPU architecture: x86_64, arm64, arm32, x86, ppc64, s390x, riscv64, mips, unknown",
  cpu: "Processor name from the NIST operating environment",
  cpu_family: "Processor family as published (e.g. X86, ARM64)",
  cpu_vendor: "Processor vendor, normalized (intel, amd, arm, ...)",
  cpu_series: "Processor series or family as published (e.g. Graviton4, Ice Lake)",
  target: "Normalized target: os_name + ' / ' + arch, or just arch for bare metal",
  target_key: "Same as target",
  pqc_algorithm: "PQC algorithm as validated, e.g. 'ML-KEM KeyGen'",
  algorithm: "Algorithm name as published",
  pqc_family: "ML-KEM | ML-DSA | SLH-DSA | LMS",
  parameter_sets: "PQC parameter sets covered by the validation",
  functions: "PQC functions covered: KeyGen, SigGen, SigVer, Encapsulation, Decapsulation",
  evidence: "Why the row is included: cavp_validated, cmvp_active, cavp_name_match",
  pqc_evidence:
    "Why an in-process module is treated as PQC: cavp_name_match | name_keyword | cavp_vendor_only | none",
  match_score: "Name-matching score for an in-process module (0 to 1)",
  matched_cavp_certs: "CAVP validations matched to an in-process module",
  matched_implementations: "CAVP implementation names matched to an in-process module",
  list: "MIP (Modules In Process) or IUT (Implementation Under Test)",
  standard: "FIPS standard, e.g. FIPS 140-3",
  level: "Overall FIPS 140-3 security level",
  embodiment: "Embodiment as published (e.g. MultiChipStand, Software)",
  first_validated: "Date first validated (ISO 8601)",
  status_date: "Date of the listed in-process status",
  sunset: "CMVP sunset date",
  lab: "Testing laboratory",
  security_policy_url: "Non-proprietary security policy PDF",
  pdf_url: "Security policy PDF the section was extracted from",
  kind: "tested | vendor_affirmed",
  page: "Page number in the PDF",
  section_text: "Quoted text of the tested or vendor-affirmed operating-environment section",
  os_candidates: "Regex hints for OS names in the section; hints only, not a parsed list",
  cpu_candidates: "Regex hints for CPU names in the section; hints only, not a parsed list",
  validation_id: "CAVP validation id",
  cmvp_cert: "CMVP certificate number",
  cavp_cert: "CAVP validation number",
  cavp_validation_id: "CAVP validation id",
  cavp_certs: "CAVP validations linked to a CMVP certificate",
  in_process_modules: "CMVP in-process modules matched to a CAVP validation",
  pqc_algorithms: "PQC algorithms in the record",
  pqc_families: "PQC families in the record",
  n_algorithms: "Number of algorithm rows",
  n_pqc_algorithms: "Number of PQC algorithm rows",
  variant:
    "Coverage scope: validated | validated_software | with_in_process | with_in_process_software",
  rank: "Rank within the variant, by products (targets file) or by set-cover order (greedy file)",
  vendors: "Distinct vendors in scope for the target",
  products: "Distinct modules in scope for the target",
  certs: "Distinct validation records in scope for the target",
  pct_products: "Products at this target as a share of all products in scope",
  cumulative_products: "Products covered by this and all better-ranked targets",
  cumulative_pct_products: "Share of all products covered cumulatively",
  cumulative_vendors: "Vendors covered by this and all better-ranked targets",
  cumulative_pct_vendors: "Share of all vendors covered cumulatively",
  targets_covered: "Targets this product covers that no earlier product covered",
  targets_total: "Targets this product covers in total",
  cumulative_targets: "Targets covered by this and all earlier products",
  pct_targets: "Share of the universe covered at this rank",
  universe_targets: "Targets in the variant"
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

function inferType(rows, index) {
  let seen = 0;
  let integer = true;
  let number = true;
  let date = true;
  for (const row of rows) {
    const value = (row[index] ?? "").trim();
    if (!value) continue;
    if (++seen > 60) break;
    if (!/^-?\d+$/.test(value)) integer = false;
    if (!/^-?\d+(\.\d+)?$/.test(value)) number = false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) date = false;
    if (!integer && !number && !date) return "string";
  }
  if (!seen) return "string";
  if (integer) return "integer";
  if (number) return "number";
  if (date) return "date";
  return "string";
}

async function buildSchema(files) {
  const tables = [];
  for (const file of files.filter((f) => f.endsWith(".csv"))) {
    const rows = parseCsv(await readFile(join(dataDir, file), "utf8"));
    if (!rows.length) continue;
    const header = rows[0];
    const body = rows.slice(1).filter((row) => row.some((value) => value !== ""));
    tables.push({
      table: file.replace(/\.csv$/, ""),
      file,
      rows: body.length,
      columns: header.map((name, i) => ({
        name,
        type: inferType(body, i),
        description: NOTES[name] ?? ""
      }))
    });
  }
  return {
    dataset: "NIST PQC validation coverage",
    site: SITE,
    generated_at: new Date().toISOString(),
    tables
  };
}

async function buildSummary(metadata) {
  const rows = parseCsv(await readFile(join(dataDir, "coverage_targets.csv"), "utf8"));
  const header = rows[0];
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const targets = rows
    .slice(1)
    .filter((row) => row[index.variant] === "validated")
    .slice(0, 10)
    .map((row) => ({
      target: row[index.target],
      products: Number(row[index.products]),
      vendors: Number(row[index.vendors])
    }));
  return {
    dataset: "NIST PQC validation coverage",
    site: SITE,
    data_as_of: metadata.data_as_of,
    generated_at: metadata.generated_at,
    counts: metadata.counts,
    pqc_algorithms: metadata.pqc_algorithms,
    top_targets: targets,
    notes: metadata.notes
  };
}

function llmsTxt(metadata) {
  const c = metadata.counts;
  return `# NIST PQC validation coverage

> NIST post-quantum validation records with normalized operating environments:
> ${c.cavp_pqc_validations} CAVP validations, ${c.cmvp_pqc_certificates} active CMVP certificates and
> ${c.cmvp_in_process_rows} CMVP modules in process, across ${c.validated_targets} validated OS/CPU targets
> (${c.with_in_process_targets} including modules in progress). Data as of ${metadata.data_as_of}.
> PQC scope: ML-KEM, ML-DSA, SLH-DSA, LMS.

The dashboard at ${SITE}/ renders these files in a browser with DuckDB-WASM.
Agents should use the files below directly: they are static, need no key, and
need no JavaScript.

## Start here

- [summary.json](${DOWNLOADS}/summary.json): headline counts, sources, top targets. Small; read this first.
- [coverage_targets.csv](${DOWNLOADS}/coverage_targets.csv): one row per normalized OS/architecture
  target per scope, ranked, with distinct product and vendor counts and cumulative coverage.
- [cmvp_certs.csv](${DOWNLOADS}/cmvp_certs.csv): the ${c.cmvp_pqc_certificates} active CMVP certificates
  with a PQC algorithm.
- [cmvp_in_process.csv](${DOWNLOADS}/cmvp_in_process.csv): the ${c.cmvp_in_process_rows} modules in process
  (MIP and IUT) with their inferred PQC evidence.
- [pqc_coverage.csv](${DOWNLOADS}/pqc_coverage.csv): ${c.coverage_rows} long-form rows, one per
  (program, record, operating environment, algorithm). About 8 MB.
- [schema.json](${DOWNLOADS}/schema.json): every table and column, with types and one-line meanings.
- Parquet copies of every CSV are in the same folder for DuckDB, pandas, Polars and Spark.

If your fetch truncates large files, use summary.json, targets.csv, certificates.csv
and in_process.csv; they are all small. The full CSV is for code execution.

## The three programs

Every row has a \`source\`:

- **CAVP** — an algorithm validation (a certificate number like A6184). A CAVP
  validation names operating environments and the algorithms validated in each.
- **CMVP** — an active FIPS 140-3 certificate (a number like 5596). Certificate
  pages do **not** list operating environments; they are inherited from the CAVP
  validations of the certificate's algorithms, which is why a CMVP row repeats a
  CAVP operating environment.
- **CMVP in progress** (\`CMVP-MIP\` and \`CMVP-IUT\`) — modules in process or under
  test at CMVP. NIST publishes no algorithms for these, so PQC relevance is
  inferred (see \`pqc_evidence\`).

## Semantics

- **validated** (\`validated = 1\`): an active CMVP certificate, or a CAVP
  validation that no active CMVP certificate covers yet. It avoids counting the
  same module twice. Use it for "certified today" questions.
- **target**: a normalized \`(os_name, arch)\` pair, labelled \`os_name / arch\`, or
  just \`arch\` when the module runs on bare metal (os_family \`none\`). Rows with
  \`arch\` empty or \`unknown\` are not targets.
- **coverage scope** (\`variant\` in the targets and greedy files): \`validated\`,
  \`validated_software\` (software modules only), \`with_in_process\`, and
  \`with_in_process_software\`. Modules in process have no published module type,
  so the software scopes exclude them.
- **os_family** values: linux, windows, macos, ios, android, freebsd, solaris,
  rtos, hypervisor, appliance, simulator, none (bare metal or hardware only),
  unknown.
- **arch** values: x86_64, arm64, arm32, x86, ppc64, s390x, riscv64, mips,
  unknown.
- \`upstream\` is a keyword match against vendor and product names (AWS-LC,
  OpenSSL, BoringSSL, wolfSSL, mbed TLS, SymCrypt, Bouncy Castle, Mozilla NSS,
  corecrypto, GnuTLS, Libgcrypt, Crypto++, Botan). Empty means unclassified, not
  "no library".

## Example questions (DuckDB)

Read the CSV directly (\`read_csv('pqc_coverage.csv', header = true)\`), or the
Parquet for speed (\`read_parquet('pqc_coverage.parquet')\`).

Products per OS family, validated only:

\`\`\`sql
SELECT os_family, count(DISTINCT vendor) AS vendors, count(DISTINCT product) AS modules
FROM read_csv('pqc_coverage.csv', header = true)
WHERE source = 'CMVP' OR (source = 'CAVP' AND status = 'none_yet')
GROUP BY 1 ORDER BY modules DESC;
\`\`\`

Software modules that cover Windows on arm64:

\`\`\`sql
SELECT DISTINCT vendor, product
FROM read_csv('pqc_coverage.csv', header = true)
WHERE arch = 'arm64' AND os_family = 'windows'
  AND upper(module_type) LIKE 'SOFTWARE%'
  AND (source = 'CMVP' OR (source = 'CAVP' AND status = 'none_yet'))
ORDER BY vendor;
\`\`\`

The targets with the most validated products (no grouping needed):

\`\`\`sql
SELECT target, products, vendors
FROM read_csv('coverage_targets.csv', header = true)
WHERE variant = 'validated' AND products > 0
ORDER BY rank LIMIT 25;
\`\`\`

Modules in process whose name or vendor matches a PQC CAVP validation:

\`\`\`sql
SELECT list, module, vendor, status, status_date, matched_cavp_certs
FROM read_csv('cmvp_in_process.csv', header = true)
WHERE pqc_evidence = 'cavp_name_match'
ORDER BY status_date DESC;
\`\`\`

Which certificates cover SLH-DSA:

\`\`\`sql
SELECT cert, vendor, module, pqc_algorithms
FROM read_csv('cmvp_certs.csv', header = true)
WHERE list_contains(string_split(pqc_families, ';'), 'SLH-DSA');
\`\`\`

## Caveats

- CMVP operating environments are inherited from CAVP, not published on the
  certificate. A CMVP certificate's target list is therefore only as complete as
  its linked CAVP validations.
- Vendor-affirmed operating environments exist only in the security-policy PDFs
  (\`cmvp_policy_sections.csv\`). They are not part of the normalized target counts.
- OS family, product and architecture are normalized heuristically from NIST's
  free-text operating-environment strings. \`os_family = 'unknown'\` means the
  normalizer did not recognize the string; it is rare.
- In-process PQC evidence is inferred by vendor and name matching; treat
  \`name_keyword\` and \`cavp_vendor_only\` as leads, not facts.
- Only modules that include a PQC algorithm are in this dataset. Classical-only
  FIPS modules are out of scope.

## Source

Scraped from the NIST CSRC CAVP and CMVP pages, retrieved ${metadata.data_as_of}:
${Object.values(metadata.nist).map((url) => `- ${url}`).join("\n")}

This is an independent compilation, not a NIST publication. When citing, name
the NIST source and the retrieval date above.
`;
}

const parquetDir = join(site, "docs", "data");
const names = (await readdir(dataDir))
  .filter((name) => /\.(csv|json)$/.test(name))
  .sort();
const parquetNames = (await readdir(parquetDir))
  .filter((name) => name.endsWith(".parquet"))
  .sort();
await mkdir(out, {recursive: true});
for (const name of names) await copyFile(join(dataDir, name), join(out, name));
for (const name of parquetNames) await copyFile(join(parquetDir, name), join(out, name));

const metadata = JSON.parse(await readFile(join(dataDir, "metadata.json"), "utf8"));
const schema = await buildSchema(names);
const summary = await buildSummary(metadata);

await writeFile(join(out, "schema.json"), JSON.stringify(schema, null, 2) + "\n");
await writeFile(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
const llms = llmsTxt(metadata);
await writeFile(join(out, "llms.txt"), llms);
await writeFile(join(dist, "llms.txt"), llms);
const robots = `User-agent: *\nAllow: /\n\n# For agents: ${SITE}/llms.txt\n`;
await writeFile(join(dist, "robots.txt"), robots);
await writeFile(join(out, "robots.txt"), robots);

// Advertise llms.txt in every page head. Framework validates <link> hrefs at
// build time, so this is done here rather than in observablehq.config.js.
const link = `<link rel="alternate" type="text/plain" href="${SITE}/llms.txt" title="llms.txt (data for agents)">`;
const pages = (await readdir(dist)).filter((name) => name.endsWith(".html"));
for (const page of pages) {
  const file = join(dist, page);
  const html = await readFile(file, "utf8");
  if (!html.includes(link)) {
    await writeFile(file, html.replace("</head>", `${link}</head>`));
  }
}

console.log(
  `published ${names.length} data files and ${parquetNames.length} Parquet files, plus llms.txt, schema.json and summary.json, to dist/downloads`
);
