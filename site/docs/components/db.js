// One DuckDB-WASM client per page, with the views every page shares.
//
// Pages pass the Parquet tables they need, keyed by the name they want in SQL.
// A view is created only when the tables it reads are present, so a page pays
// for exactly the data it queries.

import {DuckDBClient} from "npm:@observablehq/duckdb";

const VIEWS = [
  [
    "coverage",
    ["coverage_raw"],
    `CREATE OR REPLACE VIEW coverage AS
       SELECT *,
         CASE WHEN source = 'CAVP' THEN 'CAVP'
              WHEN source = 'CMVP' THEN 'CMVP'
              ELSE 'CMVP in progress' END AS program,
         source || '|' || record_id || '|' || coalesce(vendor, '') || '|' ||
           coalesce(product, '') AS product_key,
         os_label || ' \u00b7 ' || arch AS target_key
       FROM (
         SELECT *,
           CASE WHEN coalesce(os_name, '') <> '' THEN os_name
                WHEN os_family = 'none' THEN '(no OS / bare metal)'
                ELSE '(unknown OS)' END AS os_label
         FROM coverage_raw
       )`,
  ],
  [
    "validated",
    ["coverage"],
    `CREATE OR REPLACE VIEW validated AS
       SELECT * FROM coverage
       WHERE source = 'CMVP' OR (source = 'CAVP' AND status = 'none_yet')`,
  ],
  [
    "validated_software",
    ["validated"],
    `CREATE OR REPLACE VIEW validated_software AS
       SELECT * FROM validated WHERE upper(module_type) LIKE 'SOFTWARE%'`,
  ],
  [
    "with_in_process",
    ["coverage"],
    `CREATE OR REPLACE VIEW with_in_process AS
       SELECT * FROM coverage
       WHERE source <> 'CAVP' OR status = 'none_yet'`,
  ],
  [
    "with_in_process_software",
    ["with_in_process"],
    `CREATE OR REPLACE VIEW with_in_process_software AS
       SELECT * FROM with_in_process WHERE upper(module_type) LIKE 'SOFTWARE%'`,
  ],
  [
    "targets",
    ["validated"],
    `CREATE OR REPLACE VIEW targets AS
       SELECT
         CASE WHEN coalesce(os_name, '') <> '' THEN os_name || ' / ' || arch
              ELSE arch END AS target,
         os_name,
         arch,
         min(os_family) AS os_family,
         count(DISTINCT vendor) AS vendors,
         count(DISTINCT product_key) AS products,
         count(DISTINCT record_id) AS certs
       FROM validated
       WHERE arch IS NOT NULL AND arch NOT IN ('', 'unknown')
       GROUP BY os_name, arch
       ORDER BY products DESC`,
  ],
];

/** Open the client and build every view whose inputs were supplied. */
export async function openDb(tables) {
  const db = await DuckDBClient.of(tables);
  const available = new Set(Object.keys(tables));
  for (const [name, requires, definition] of VIEWS) {
    if (!requires.every((table) => available.has(table))) continue;
    await db.query(definition);
    available.add(name);
  }
  return db;
}

/** Run a query and return plain row objects. */
export async function query(db, sql, params = []) {
  return (await db.query(sql, params)).toArray();
}
