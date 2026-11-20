// Statement validation and execution for the SQL console.
//
// The console runs in the reader's own browser against read-only Parquet, so the
// guard is about clear errors and avoiding statements that cannot work in
// DuckDB-WASM (ATTACH, COPY, reading remote files), not about untrusted input.

const ALLOWED_START = /^(select|with|from|describe|summarize|pivot|show)\b/i;
const FORBIDDEN =
  /\b(attach|detach|copy|export|import|install|load|create|insert|update|delete|drop|alter|pragma|call|vacuum|checkpoint|force)\b/i;
const REMOTE_READ = /\bread_(csv|parquet|json|json_auto|text|blob)\s*\(/i;

/** Check a statement before running it; the console accepts one read-only query. */
export function validateStatement(sql) {
  const text = (sql ?? "").trim().replace(/;\s*$/, "");
  if (!text) return {ok: false, reason: "Enter a query."};
  if (!ALLOWED_START.test(text)) {
    return {ok: false, reason: "Start the query with SELECT, WITH, FROM, DESCRIBE or SUMMARIZE."};
  }
  const forbidden = text.match(FORBIDDEN);
  if (forbidden) {
    return {ok: false, reason: `The console is read-only: ${forbidden[0].toUpperCase()} is not allowed.`};
  }
  if (REMOTE_READ.test(text)) {
    return {ok: false, reason: "The data is local; read_csv/read_parquet are not available."};
  }
  if (text.includes(";")) {
    return {ok: false, reason: "Run one statement at a time (remove the semicolon)."};
  }
  return {ok: true, sql: text};
}

/** Run one statement and return columns, rows, timings or an error message. */
export async function runStatement(db, sql) {
  const check = validateStatement(sql);
  if (!check.ok) return {error: check.reason, sql: check.sql ?? sql};

  const started = performance.now();
  try {
    const table = await db.query(check.sql);
    const rows = table.toArray();
    const fields = table.schema.fields;
    const columns = fields.map((field) => field.name);
    formatDates(rows, fields);
    return {rows, columns, ms: performance.now() - started, sql: check.sql};
  } catch (error) {
    return {error: error?.message ?? String(error), ms: performance.now() - started, sql: check.sql};
  }
}

// Arrow returns DATE as epoch milliseconds and TIMESTAMP as a number or bigint;
// render both as readable text so tables and CSV match the rest of the site.
// Arrow type ids: 8 = Date, 10 = Timestamp.
function formatDates(rows, fields) {
  const dateColumns = [];
  const timeColumns = [];
  for (const field of fields) {
    if (field.type.typeId === 8) dateColumns.push(field.name);
    else if (field.type.typeId === 10) timeColumns.push(field.name);
  }
  if (!dateColumns.length && !timeColumns.length) return;

  const asDate = (value) => {
    if (typeof value === "bigint") return new Date(Number(value) / 1e6);
    return value instanceof Date ? value : new Date(Number(value));
  };
  for (const row of rows) {
    for (const column of dateColumns) {
      if (row[column] == null) continue;
      row[column] = asDate(row[column]).toISOString().slice(0, 10);
    }
    for (const column of timeColumns) {
      if (row[column] == null) continue;
      row[column] = asDate(row[column]).toISOString().slice(0, 19).replace("T", " ");
    }
  }
}

/** Serialise rows to CSV, the way the exporter would. */
export function toCsv(rows, columns) {
  const quote = (value) => {
    if (value === null || value === undefined) return "";
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.join(","), ...rows.map((row) => columns.map((c) => quote(row[c])).join(","))].join("\n");
}

export const EXAMPLES = [
  {
    label: "Products per OS family and architecture",
    sql: `SELECT os_family, arch,
       count(DISTINCT product_key) AS products,
       count(DISTINCT vendor) AS vendors
FROM validated
WHERE arch NOT IN ('', 'unknown')
GROUP BY os_family, arch
ORDER BY products DESC`
  },
  {
    label: "Top targets and what they miss",
    sql: `SELECT target, products, vendors, certs
FROM targets
ORDER BY products DESC
LIMIT 25`
  },
  {
    label: "Vendors with the widest coverage",
    sql: `SELECT vendor,
       count(DISTINCT product_key) AS products,
       count(DISTINCT target_key) AS targets,
       string_agg(DISTINCT pqc_family, ', ' ORDER BY pqc_family) AS families
FROM validated
GROUP BY vendor
ORDER BY targets DESC, products DESC
LIMIT 20`
  },
  {
    label: "ML-KEM parameter sets in validated products",
    sql: `SELECT pqc_algorithm, parameter_sets,
       count(DISTINCT product_key) AS products
FROM validated
WHERE pqc_family = 'ML-KEM'
GROUP BY pqc_algorithm, parameter_sets
ORDER BY products DESC`
  },
  {
    label: "In-process modules matched to a CAVP validation",
    sql: `SELECT module, vendor, list, status, status_date, match_score, matched_cavp_certs
FROM in_process
WHERE pqc_evidence = 'cavp_name_match'
ORDER BY status_date DESC NULLS LAST
LIMIT 50`
  },
  {
    label: "Software products on Linux and Windows",
    sql: `SELECT os_name, arch,
       count(DISTINCT product_key) AS products,
       count(DISTINCT vendor) AS vendors
FROM validated_software
WHERE os_family IN ('linux', 'windows')
GROUP BY os_name, arch
ORDER BY products DESC`
  }
];
