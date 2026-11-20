// "Ask" agent: a small model in a Web Worker turns a question into SQL, runs it
// against the page's DuckDB, and answers in a chat drawer. Everything stays in
// the browser; nothing is uploaded.
//
// It only appears on desktop machines that have a usable WebGPU adapter, and the
// model is a ~1 GB download, so nothing is fetched until the reader asks.
import {query} from "./db.js";
import {runStatement, toCsv, validateStatement} from "./sql.js";
import {barChart, lineChart} from "./echarts.js";

export const MODELS = [
  {
    id: "Qwen2.5-Coder-1.5B-Instruct",
    label: "Qwen2.5-Coder 1.5B",
    size: "~1.0 GB",
    note: "default: fast, writes plain SQL"
  },
  {
    id: "Qwen3.5-2B",
    label: "Qwen3.5 2B",
    size: "~1.4 GB",
    note: "experimental: reasons better"
  }
];

export function modelId(model, shaderF16) {
  return `${model.id}-${shaderF16 ? "q4f16_1" : "q4f32_1"}-MLC`;
}

/** Decide whether this browser can run the panel, and with which weights. */
export async function capability() {
  const desktop = matchMedia("(pointer: fine)").matches && window.innerWidth >= 1024;
  if (!desktop) return {ok: false, reason: "The model needs a desktop-sized window; the console below works everywhere."};
  if (!navigator.gpu) return {ok: false, reason: "This browser has no WebGPU, so the local model cannot run here."};
  let adapter = null;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch (error) {
    return {ok: false, reason: `WebGPU is present but the adapter failed: ${error?.message ?? error}`};
  }
  if (!adapter) return {ok: false, reason: "WebGPU is present but no graphics adapter was available."};
  const oneGiB = 1024 * 1024 * 1024;
  if (adapter.limits?.maxBufferSize < oneGiB) {
    return {ok: false, reason: "The graphics adapter cannot allocate the memory the model needs."};
  }
  return {ok: true, shaderF16: adapter.features.has("shader-f16"), adapter};
}

/** Is a model already in the browser cache? */
export async function isModelCached(id) {
  try {
    const cache = await caches.open("webllm/model");
    const requests = await cache.keys();
    return requests.some((request) => decodeURIComponent(request.url).includes(id));
  } catch {
    return false;
  }
}

export async function storageInfo() {
  if (!navigator.storage?.estimate) return null;
  const {usage = 0, quota = 0} = await navigator.storage.estimate();
  const gb = (value) => `${(value / 1024 ** 3).toFixed(2)} GB`;
  return {usage, quota, label: `${gb(usage)} of ${gb(quota)} used by this site`};
}

const VIEW_NOTES = `Tables (DuckDB, read-only):
coverage: one row per source, record, environment and algorithm. Columns: source, record_id, vendor, product, module_type, os_name, os_family, arch, cpu, cpu_series, pqc_algorithm, pqc_family, parameter_sets, status, first_validated, upstream, os_label, product_key, target_key.
validated: coverage rows for CMVP certificates plus CAVP validations with no CMVP certificate.
validated_software: validated where module_type starts with SOFTWARE.
with_in_process: validated plus modules in process at CMVP.
targets: one row per (os_name, arch) over validated: target, os_family, vendors, products, certs.
cavp: one row per CAVP validation: cert, vendor, implementation, cmvp_status.
in_process: one row per CMVP in-process module: module, vendor, list, status, status_date, pqc_evidence.
Rules: one SELECT, no semicolon; only use tables listed as available; use validated (not coverage) for validated products; count products with count(DISTINCT product_key); ILIKE for names.`;

const EXAMPLES = `Examples:
Q: Which software modules cover Windows on arm64?
A: {"title":"Software on Windows arm64","sql":"SELECT vendor, product FROM validated_software WHERE os_family = 'windows' AND arch = 'arm64' ORDER BY vendor","chart":"none"}
Q: How many validated products are there per PQC family?
A: {"title":"Products per PQC family","sql":"SELECT pqc_family, count(DISTINCT product_key) AS products FROM validated GROUP BY 1 ORDER BY 2 DESC","chart":"bar","x":"pqc_family","y":"products"}
Q: Which targets have the most validated products?
A: {"title":"Top targets","sql":"SELECT target, products, vendors FROM targets ORDER BY products DESC LIMIT 25","chart":"bar","x":"target","y":"products"}
Q: Which CAVP validations have no CMVP certificate yet?
A: {"title":"CAVP validations without a CMVP certificate","sql":"SELECT cert, vendor, implementation FROM cavp WHERE cmvp_status = 'none_yet' ORDER BY vendor","chart":"none"}`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: {type: "string"},
    sql: {type: "string"},
    chart: {type: "string", enum: ["bar", "line", "none"]},
    x: {type: "string"},
    y: {type: "string"}
  },
  required: ["title", "sql", "chart"]
};

/** The prompt: view notes, the live schema, and the real values that matter. */
export function buildPrompt(schemaText) {
  return `You translate questions about NIST post-quantum cryptography validation data into DuckDB SQL.
${VIEW_NOTES}

Live schema (column types from the browser database):
${schemaText}

${EXAMPLES}

Answer with JSON only: {"title": short title, "sql": one SELECT, "chart": "bar"|"line"|"none", "x": category column, "y": numeric column}.`;
}

/** Collect a compact schema and the distinct values the model needs. */
export async function describeData(db) {
  const columns = await query(
    db,
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name = 'coverage'
     ORDER BY ordinal_position`
  );
  const schema = `coverage columns: ${columns
    .map((row) => `${row.column_name} ${row.data_type.toLowerCase()}`)
    .join(", ")}`;

  const [tables, values] = await Promise.all([
    query(
      db,
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'main' ORDER BY 1`
    ),
    Promise.all(
      ["os_family", "arch", "source", "pqc_family"].map(async (column) => {
        const rows = await query(
          db,
          `SELECT DISTINCT ${column} AS value FROM coverage
           WHERE ${column} IS NOT NULL AND ${column} <> '' ORDER BY 1`
        );
        return `${column}: ${rows.map((row) => row.value).join(", ")}`;
      })
    )
  ]);
  const available = `Available tables: ${tables.map((row) => row.table_name).join(", ")}`;
  return `${schema}\n${available}\nDistinct values — ${values.join("; ")}`;
}

function parseAnswer(text) {
  const trimmed = String(text ?? "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  const answer = JSON.parse(candidate);
  if (typeof answer.sql !== "string") throw new Error("The model did not return SQL.");
  return {
    title: typeof answer.title === "string" ? answer.title : "Answer",
    sql: answer.sql,
    chart: ["bar", "line", "none"].includes(answer.chart) ? answer.chart : "none",
    x: typeof answer.x === "string" ? answer.x : "",
    y: typeof answer.y === "string" ? answer.y : ""
  };
}

/**
 * One-shot question for the evaluation page: load the model in a fresh worker,
 * ask, and shut the worker down again. Slower than the panel (each call starts
 * the engine) but stateless, so one bad answer cannot spoil the next.
 */
export async function askOnce({source, model, system, question, onProgress}) {
  const text = await source.text();
  const url = URL.createObjectURL(new Blob([text], {type: "text/javascript"}));
  const worker = new Worker(url, {type: "module"});
  let requestId = 0;
  const pending = new Map();
  worker.onmessage = (event) => {
    const data = event.data ?? {};
    if (data.type === "progress") return onProgress?.(data);
    const handler = pending.get(data.id);
    if (!handler) return;
    pending.delete(data.id);
    if (data.type === "error") handler.reject(new Error(data.error));
    else handler.resolve(data);
  };
  const send = (payload) =>
    new Promise((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, {resolve, reject});
      worker.postMessage({...payload, id});
    });
  try {
    await send({type: "init", model: modelId(model, true)});
    const reply = await send({
      type: "chat",
      messages: [
        {role: "system", content: system},
        {role: "user", content: question}
      ],
      schema: RESPONSE_SCHEMA,
      maxTokens: 400,
      temperature: 0
    });
    return parseAnswer(reply.text);
  } finally {
    worker.terminate();
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** A compact table for the chat: the first columns, the first rows. */
function resultTable(out, limit = 25) {
  const wrap = element("div", "agent-table");
  const columns = out.columns.length > 6 ? out.columns.slice(0, 6) : out.columns;
  const table = element("table");
  const head = element("thead");
  const headRow = element("tr");
  for (const column of columns) headRow.append(element("th", "", column));
  head.append(headRow);
  const body = element("tbody");
  for (const row of out.rows.slice(0, limit)) {
    const tr = element("tr");
    for (const column of columns) {
      const value = row[column];
      tr.append(element("td", "", value == null ? "" : String(value)));
    }
    body.append(tr);
  }
  table.append(head, body);
  wrap.append(table);
  if (out.rows.length > limit) {
    wrap.append(element("p", "small muted", `Showing ${limit} of ${out.rows.length} rows. Ask for fewer columns or use the SQL console.`));
  }
  return wrap;
}

/** The drawer: a floating button that opens a chat about the data. */
export function createAgent({db, onSql, source, describe, models = MODELS, shaderF16 = true}) {
  const root = element("div", "agent");
  root.innerHTML = `
    <button type="button" class="agent-fab" aria-expanded="false" aria-controls="agent-drawer">
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
        <path d="M12 2.6l1.9 5.3 5.3 1.9-5.3 1.9L12 17l-1.9-5.3L4.8 9.8l5.3-1.9L12 2.6z" fill="currentColor"/>
      </svg>
      <span>Ask</span>
    </button>
    <aside class="agent-drawer" id="agent-drawer" hidden aria-label="Ask the data">
      <header class="agent-head">
        <div>
          <h3>Ask the data</h3>
          <p class="small muted">A small model in this browser writes the SQL and runs it.
            Nothing is uploaded.</p>
        </div>
        <button type="button" class="agent-close" aria-label="Close the chat">&times;</button>
      </header>
      <details class="agent-setup" open>
        <summary class="small">Model <span class="agent-model-label"></span>
          <span class="agent-badge" hidden></span></summary>
        <div class="agent-setup-body">
          <select class="agent-model" aria-label="Model"></select>
          <button type="button" class="agent-load">Download model</button>
          <button type="button" class="agent-delete" hidden>Delete</button>
          <span class="agent-storage small muted"></span>
        </div>
        <div class="agent-progress" hidden>
          <div class="agent-progress-track"><div class="agent-progress-fill"></div></div>
          <span class="agent-progress-text small muted"></span>
        </div>
      </details>
      <div class="agent-log" aria-live="polite">
        <div class="agent-empty small muted">
          <p>Ask about the data in plain English, for example:</p>
          <ul>
            <li>Which software modules cover Windows on arm64?</li>
            <li>How many validated products are there per PQC family?</li>
            <li>Which vendors cover the most OS and CPU targets?</li>
          </ul>
        </div>
      </div>
      <form class="agent-composer">
        <textarea class="agent-question" rows="1" placeholder="Ask a question about the data"
          aria-label="Ask a question about the data"></textarea>
        <button type="submit" class="agent-send">Ask</button>
        <button type="button" class="agent-stop" hidden>Stop</button>
      </form>
    </aside>
  `;

  const fab = root.querySelector(".agent-fab");
  const drawer = root.querySelector(".agent-drawer");
  const closeButton = root.querySelector(".agent-close");
  const setup = root.querySelector(".agent-setup");
  const modelSelect = root.querySelector(".agent-model");
  const modelLabel = root.querySelector(".agent-model-label");
  const loadButton = root.querySelector(".agent-load");
  const deleteButton = root.querySelector(".agent-delete");
  const storageLabel = root.querySelector(".agent-storage");
  const progress = root.querySelector(".agent-progress");
  const progressFill = root.querySelector(".agent-progress-fill");
  const progressText = root.querySelector(".agent-progress-text");
  const log = root.querySelector(".agent-log");
  const empty = root.querySelector(".agent-empty");
  const composer = root.querySelector(".agent-composer");
  const question = root.querySelector(".agent-question");
  const sendButton = root.querySelector(".agent-send");
  const stopButton = root.querySelector(".agent-stop");
  const badge = root.querySelector(".agent-badge");

  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.label} (${model.size})`;
    modelSelect.append(option);
  }

  let worker = null;
  let requestId = 0;
  let pending = new Map();
  let ready = null; // model id loaded in the worker
  let schemaText = null;
  let generating = false;
  let open = false;

  const selected = () => models.find((model) => model.id === modelSelect.value) ?? models[0];

  function setProgress(fraction, text) {
    progress.hidden = false;
    progressFill.style.width = `${Math.round((fraction ?? 0) * 100)}%`;
    progressText.textContent = text ?? "";
  }

  function scrollLog() {
    log.scrollTop = log.scrollHeight;
  }

  function showDrawer(show) {
    open = show;
    drawer.hidden = !show;
    fab.setAttribute("aria-expanded", String(show));
    if (show) {
      question.focus();
      scrollLog();
    }
  }

  function send(payload) {
    if (!worker) throw new Error("The model worker is not running.");
    const id = ++requestId;
    payload.id = id;
    return new Promise((resolve, reject) => {
      pending.set(id, {resolve, reject});
      worker.postMessage(payload);
    });
  }

  async function ensureWorker() {
    if (worker) return worker;
    const text = await source.text();
    const url = URL.createObjectURL(new Blob([text], {type: "text/javascript"}));
    worker = new Worker(url, {type: "module"});
    worker.onmessage = (event) => {
      const data = event.data ?? {};
      if (data.type === "progress") {
        setProgress(data.progress, data.text);
        return;
      }
      const handler = pending.get(data.id);
      if (!handler) return;
      pending.delete(data.id);
      if (data.type === "error") handler.reject(new Error(data.error));
      else handler.resolve(data);
    };
    worker.onerror = (event) => {
      for (const handler of pending.values()) handler.reject(new Error(event.message));
      pending.clear();
    };
    return worker;
  }

  async function refreshModel() {
    const model = selected();
    const id = modelId(model, shaderF16);
    const cached = await isModelCached(id);
    modelLabel.textContent = model.label;
    badge.hidden = !cached;
    badge.textContent = cached ? "cached" : "";
    loadButton.textContent = cached ? "Load model" : `Download model (${model.size})`;
    deleteButton.hidden = !cached;
    const info = await storageInfo();
    storageLabel.textContent = info?.label ?? "";
    if (!cached) ready = null;
    setup.open = !ready;
    return cached;
  }

  async function loadModel() {
    const model = selected();
    const id = modelId(model, shaderF16);
    loadButton.disabled = true;
    setProgress(0, "Starting\u2026");
    try {
      await navigator.storage?.persist?.();
      await ensureWorker();
      await send({type: "init", model: id});
      ready = id;
      progress.hidden = true;
      await refreshModel();
      question.focus();
    } catch (error) {
      progress.hidden = true;
      throw error;
    } finally {
      loadButton.disabled = false;
    }
  }

  async function removeModel() {
    const model = selected();
    const id = modelId(model, shaderF16);
    try {
      if (worker) await send({type: "delete", model: id});
      ready = null;
      await refreshModel();
    } catch (error) {
      appendError(`Could not delete the model: ${error?.message ?? error}`);
    }
  }

  function appendMessage(className) {
    empty.hidden = true;
    const message = element("div", `agent-msg ${className}`);
    log.append(message);
    scrollLog();
    return message;
  }

  function appendError(text) {
    const message = appendMessage("agent-assistant");
    message.append(element("p", "agent-error", text));
    scrollLog();
  }

  function renderAnswer(message, answer, out) {
    message.replaceChildren();
    message.append(element("h4", "agent-title", answer.title));

    const sqlBlock = element("pre", "agent-sql");
    sqlBlock.append(element("code", "", out.sql ?? answer.sql));
    message.append(sqlBlock);

    const actions = element("div", "agent-actions");
    const copy = element("button", "agent-action", "Copy SQL");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(out.sql ?? answer.sql);
        copy.textContent = "Copied";
        setTimeout(() => (copy.textContent = "Copy SQL"), 1500);
      } catch {
        copy.textContent = "Copy failed";
      }
    });
    actions.append(copy);

    if (onSql) {
      const open = element("button", "agent-action", "Open in console");
      open.type = "button";
      open.addEventListener("click", () => {
        onSql(out.sql ?? answer.sql, {...answer, run: false});
        showDrawer(false);
        document.querySelector(".sql-console")?.scrollIntoView({behavior: "smooth", block: "center"});
      });
      actions.append(open);
    }

    const csv = element("button", "agent-action", "CSV");
    csv.type = "button";
    csv.addEventListener("click", () => {
      const blob = new Blob([toCsv(out.rows, out.columns)], {type: "text/csv"});
      const link = element("a");
      link.href = URL.createObjectURL(blob);
      link.download = "answer.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
    actions.append(csv);

    actions.append(
      element("span", "agent-meta small muted", `${out.rows.length} rows \u00b7 ${out.ms.toFixed(0)} ms`)
    );
    message.append(actions);

    if (out.rows.length) {
      const canChart =
        answer.chart !== "none" &&
        out.columns.includes(answer.x) &&
        out.columns.includes(answer.y);
      if (canChart) {
        try {
          const chart =
            answer.chart === "line"
              ? lineChart(out.rows, {x: answer.x, series: [{key: answer.y, label: answer.y}], height: 230})
              : barChart(out.rows, {
                  x: answer.x,
                  y: answer.y,
                  height: 230,
                  rotate: out.rows.length > 6 ? -35 : 0,
                  truncate: 26
                });
          message.append(chart);
        } catch {
          message.append(resultTable(out));
        }
      } else {
        message.append(resultTable(out));
      }
    } else {
      message.append(element("p", "small muted", "No rows."));
    }
    scrollLog();
  }

  function renderFailure(message, answer, error) {
    message.replaceChildren();
    message.append(element("h4", "agent-title", answer.title));
    const sqlBlock = element("pre", "agent-sql");
    sqlBlock.append(element("code", "", answer.sql));
    message.append(sqlBlock);
    message.append(
      element("p", "agent-error", `That SQL did not run: ${error?.message ?? "unknown error"}. It is in the box above; you can edit it in the SQL console.`)
    );
    const actions = element("div", "agent-actions");
    const copy = element("button", "agent-action", "Copy SQL");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(answer.sql);
      copy.textContent = "Copied";
    });
    actions.append(copy);
    message.append(actions);
    scrollLog();
  }

  async function generate(messages) {
    const reply = await send({type: "chat", messages, schema: RESPONSE_SCHEMA, maxTokens: 400});
    return parseAnswer(reply.text);
  }

  async function ask(text) {
    if (generating) return;
    generating = true;
    sendButton.disabled = true;
    stopButton.hidden = false;
    const message = appendMessage("agent-assistant");
    const status = element("p", "agent-status small muted", ready ? "Thinking\u2026" : "Loading the model\u2026");
    message.append(status);
    scrollLog();
    try {
      if (!ready) {
        await loadModel();
        if (!ready) throw new Error("The model did not load.");
        status.textContent = "Thinking\u2026";
      }
      if (!schemaText) schemaText = await describe();
      const messages = [
        {role: "system", content: buildPrompt(schemaText)},
        {role: "user", content: text}
      ];

      let answer = null;
      let out = null;
      let lastError = null;
      for (let attempt = 0; attempt < 2 && !out; attempt++) {
        try {
          answer = await generate(messages);
        } catch (error) {
          lastError = error;
          break;
        }
        const check = validateStatement(answer.sql);
        if (!check.ok) {
          lastError = new Error(check.reason);
          messages.push({role: "assistant", content: JSON.stringify(answer)});
          messages.push({
            role: "user",
            content: `That SQL cannot run: ${check.reason} Write one read-only SELECT query.`
          });
          continue;
        }
        status.textContent = `Running ${answer.title}\u2026`;
        out = await runStatement(db, answer.sql);
        if (out.error) {
          lastError = new Error(out.error);
          messages.push({role: "assistant", content: JSON.stringify(answer)});
          messages.push({
            role: "user",
            content: `DuckDB said: ${out.error}. Fix the query and return JSON again.`
          });
          out = null;
        }
      }

      if (out && answer) renderAnswer(message, answer, out);
      else if (answer) renderFailure(message, answer, lastError);
      else {
        message.replaceChildren(
          element(
            "p",
            "agent-error",
            `The model could not answer: ${String(lastError?.message ?? "unknown error").replace(/\.$/, "")}. Try again, or reload the page if it keeps happening.`
          )
        );
      }
    } catch (error) {
      message.replaceChildren(element("p", "agent-error", error?.message ?? String(error)));
    } finally {
      generating = false;
      sendButton.disabled = false;
      stopButton.hidden = true;
      scrollLog();
    }
  }

  fab.addEventListener("click", () => showDrawer(!open));
  closeButton.addEventListener("click", () => showDrawer(false));
  drawer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") showDrawer(false);
  });
  modelSelect.addEventListener("change", () => refreshModel());
  loadButton.addEventListener("click", () => {
    loadModel().catch((error) =>
      appendError(`Could not load the model: ${error?.message ?? error}`)
    );
  });
  deleteButton.addEventListener("click", removeModel);
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = question.value.trim();
    if (!text) return;
    question.value = "";
    question.style.height = "";
    const echo = appendMessage("agent-user");
    echo.textContent = text;
    ask(text);
  });
  question.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });
  question.addEventListener("input", () => {
    question.style.height = "auto";
    question.style.height = `${Math.min(question.scrollHeight, 120)}px`;
  });
  stopButton.addEventListener("click", () => {
    worker?.postMessage({id: ++requestId, type: "abort"});
    for (const handler of pending.values()) handler.reject(new Error("Stopped."));
    pending.clear();
  });

  refreshModel();
  return {el: root, open: () => showDrawer(true), close: () => showDrawer(false)};
}

/** Mount the agent on the page body if this browser can run it. */
export async function mountAgent({db, onSql, source}) {
  const report = await capability();
  if (!report.ok) return null;
  const agent = createAgent({
    db,
    onSql,
    source,
    describe: () => describeData(db),
    shaderF16: report.shaderF16
  });
  // The page main element is a stacking context below the table of contents, so
  // a floating button has to live on the body to sit above it.
  document.querySelectorAll("body > .agent").forEach((node) => node.remove());
  document.body.append(agent.el);
  return agent;
}
