---
title: Model evaluation
---

# Model evaluation

A development page, not in the navigation. It asks the local model a set of real
questions, runs the SQL it writes, and compares the result with a reference
query. Use it to choose between the models offered in the Ask panel.

```js
import {openDb, query} from "./components/db.js";
import {askOnce, buildPrompt, capability, describeData, MODELS} from "./components/ask.js";
```

```js
const db = await openDb({
  coverage_raw: FileAttachment("data/pqc_coverage.parquet"),
  coverage_targets: FileAttachment("data/coverage_targets.parquet"),
  coverage_greedy: FileAttachment("data/coverage_greedy.parquet"),
  cavp: FileAttachment("data/cavp_validations.parquet"),
  in_process: FileAttachment("data/cmvp_in_process.parquet")
});
```

```js
const CASES = [
  {
    question: "How many validated products are there per PQC family?",
    reference: `SELECT pqc_family, count(DISTINCT product_key) AS n FROM validated GROUP BY 1 ORDER BY 2 DESC`
  },
  {
    question: "Which ten targets have the most validated products?",
    reference: `SELECT target, products FROM targets ORDER BY products DESC LIMIT 10`
  },
  {
    question: "Which software modules cover Windows on arm64?",
    reference: `SELECT vendor, product FROM validated_software WHERE os_family = 'windows' AND arch = 'arm64' ORDER BY 1, 2`
  },
  {
    question: "Which CAVP validations have no CMVP certificate yet? List twenty.",
    reference: `SELECT cert, vendor FROM cavp WHERE cmvp_status = 'none_yet' ORDER BY cert LIMIT 20`
  },
  {
    question: "Which ten vendors have the most validated products?",
    reference: `SELECT vendor, count(DISTINCT product_key) AS products FROM validated GROUP BY 1 ORDER BY 2 DESC LIMIT 10`
  },
  {
    question: "How many validated products are there for each ML-KEM parameter set?",
    reference: `SELECT parameter_sets, count(DISTINCT product_key) AS products FROM validated WHERE pqc_family = 'ML-KEM' GROUP BY 1 ORDER BY 2 DESC`
  },
  {
    question: "Which products are validated for Apple macOS on arm64?",
    reference: `SELECT vendor, product, os_name FROM validated_software WHERE os_family = 'macos' AND arch = 'arm64' ORDER BY 1, 2`
  },
  {
    question: "How many validated products are there for each source?",
    reference: `SELECT source, count(DISTINCT product_key) AS products FROM validated GROUP BY 1 ORDER BY 2 DESC`
  },
  {
    question: "Which ten vendors validate the most OS and CPU targets?",
    reference: `SELECT vendor, count(DISTINCT target_key) AS targets FROM validated GROUP BY 1 ORDER BY 2 DESC LIMIT 10`
  },
  {
    question: "Which in-process modules are matched to a CAVP validation? List twenty by status date.",
    reference: `SELECT module, vendor FROM in_process WHERE pqc_evidence = 'cavp_name_match' ORDER BY status_date DESC NULLS LAST LIMIT 20`
  },
  {
    question: "How many distinct operating environments are there for each OS family?",
    reference: `SELECT os_family, count(DISTINCT target_key) AS targets FROM validated WHERE arch NOT IN ('', 'unknown') GROUP BY 1 ORDER BY 2 DESC`
  },
  {
    question: "Which products come from the OpenSSL upstream library?",
    reference: `SELECT DISTINCT vendor, product FROM validated WHERE upstream = 'OpenSSL' ORDER BY 1, 2`
  }
];
```

```js
const report = await capability();
```

```js
const evalEl = (() => {
  const el = document.createElement("div");
  el.className = "ask-eval";
  el.innerHTML = `
    <div class="sql-toolbar">
      <button type="button" class="sql-run eval-run">Run all ${CASES.length}</button>
      <span class="eval-progress small muted"></span>
    </div>
    <div class="eval-result"></div>
  `;
  return el;
})();
```

```js
const modelSelect = (() => {
  const el = document.createElement("label");
  el.className = "small";
  el.innerHTML = "Model <select></select>";
  for (const model of MODELS) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    el.querySelector("select").append(option);
  }
  return el;
})();
display(modelSelect);
```

```js
display(evalEl);
```

```js
if (!report.ok) {
  display(html`<div class="note small">${report.reason}</div>`);
}
```

```js
const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);

const normalise = (rows) =>
  JSON.stringify(
    rows
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, typeof value === "number" ? Math.round(value * 1000) / 1000 : value])
        )
      )
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  );

const runAll = async () => {
  const progress = evalEl.querySelector(".eval-progress");
  const out = evalEl.querySelector(".eval-result");
  const button = evalEl.querySelector(".eval-run");
  const model = MODELS.find((m) => m.id === modelSelect.querySelector("select").value) ?? MODELS[0];
  button.disabled = true;
  out.replaceChildren();

  const system = buildPrompt(await describeData(db));
  const results = [];
  for (const [index, item] of CASES.entries()) {
    progress.textContent = `${index + 1} / ${CASES.length}`;
    try {
      const generated = await askOnce({
        source: FileAttachment("data/llm-worker.worker"),
        model,
        system,
        question: item.question,
        onProgress: (data) => {
          if (data.text) progress.textContent = `${index + 1} / ${CASES.length} \u00b7 ${data.text}`;
        }
      });
      let status = "error";
      let actual = [];
      try {
        actual = await query(db, generated.sql);
        const expected = await query(db, item.reference);
        status = normalise(actual) === normalise(expected) ? "match" : "different";
      } catch (error) {
        status = "sql-error";
      }
      results.push({question: item.question, status, generated: generated.sql});
    } catch (error) {
      results.push({question: item.question, status: "model-error", generated: String(error?.message ?? error)});
    }
    progress.textContent = `${index + 1} / ${CASES.length}`;
  }

  const passed = results.filter((r) => r.status === "match").length;
  const body = results
    .map(
      (r) => `<tr class="${r.status}">
        <td>${r.status}</td>
        <td>${escapeHtml(r.question)}</td>
        <td><code>${escapeHtml(r.generated)}</code></td>
      </tr>`
    )
    .join("");
  out.innerHTML = `
    <p class="small"><strong>${passed} of ${results.length}</strong> answered with exactly the reference rows.</p>
    <div class="table-scroll"><table class="sql-table">
      <thead><tr><th>Result</th><th>Question</th><th>SQL written by the model</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  `;
  button.disabled = false;
  window.__evalResults = results;
};

evalEl.querySelector(".eval-run").addEventListener("click", runAll);
```

## Results

Run the evaluation on a desktop with WebGPU, then read the table above. The
reference queries are the definition of a correct answer: a model scores a
match only when its result has exactly the same rows.
