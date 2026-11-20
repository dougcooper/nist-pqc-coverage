// Web Worker that hosts the WebLLM engine, so token generation never blocks
// the page. The main thread talks to it with simple request/response messages
// (see components/ask.js) instead of bundling WebLLM into the page.
import {
  CreateMLCEngine,
  deleteModelAllInfoInCache,
  prebuiltAppConfig
} from "@mlc-ai/web-llm";

let engine = null;
let loadedModel = null;

const models = prebuiltAppConfig.model_list
  .filter((model) => /Qwen/.test(model.model_id))
  .map((model) => model.model_id);

function send(message) {
  self.postMessage(message);
}

function describe(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function init({id, model}) {
  if (engine && loadedModel === model) {
    send({id, type: "status", status: "ready", model, models});
    return;
  }
  if (engine) {
    await engine.unload();
    engine = null;
    loadedModel = null;
  }
  engine = await CreateMLCEngine(
    model,
    {
      initProgressCallback: ({progress, text, timeElapsed}) => {
        send({id, type: "progress", progress, text, timeElapsed});
      }
    },
    // The default 32k context allocates a KV cache big enough to exhaust
    // shared GPU memory on laptops, which shows up as a lost WebGPU device on
    // the first long prompt. A few thousand tokens is plenty for this task.
    {context_window_size: 2048, prefill_chunk_size: 1024}
  );
  loadedModel = model;
  send({id, type: "status", status: "ready", model, models});
}

async function chat({id, messages, schema, maxTokens = 400, temperature = 0}) {
  if (!engine) throw new Error("The model is not loaded yet.");
  const model = loadedModel;
  const request = () =>
    engine.chat.completions.create({
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(schema
        ? {response_format: {type: "json_object", schema: JSON.stringify(schema)}}
        : {})
    });
  let reply;
  try {
    await engine.resetChat();
    reply = await request();
  } catch (error) {
    // Shared-memory GPUs occasionally drop the WebGPU device mid-generation.
    // A fresh engine fixes it, so reload once and retry before giving up.
    if (!/device|GPUBuffer|mapAsync|unmapped|GPU/i.test(describe(error))) throw error;
    send({id, type: "progress", progress: 0, text: "Graphics hiccup \u2014 reloading the model\u2026"});
    engine = null;
    loadedModel = null;
    await CreateMLCEngine(
      model,
      {initProgressCallback: ({progress, text, timeElapsed}) => send({id, type: "progress", progress, text, timeElapsed})},
      {context_window_size: 2048, prefill_chunk_size: 1024}
    ).then((fresh) => {
      engine = fresh;
      loadedModel = model;
    });
    reply = await request();
  }
  const text = reply.choices?.[0]?.message?.content ?? "";
  send({id, type: "done", text, usage: reply.usage ?? null});
}

self.onmessage = async (event) => {
  const message = event.data ?? {};
  const {id, type} = message;
  try {
    switch (type) {
      case "ping":
        send({id, type: "pong", models});
        break;
      case "init":
        await init(message);
        break;
      case "chat":
        await chat(message);
        break;
      case "abort":
        engine?.interruptGenerate();
        send({id, type: "status", status: "aborted"});
        break;
      case "unload":
        if (engine) await engine.unload();
        engine = null;
        loadedModel = null;
        send({id, type: "status", status: "unloaded"});
        break;
      case "delete":
        if (engine) await engine.unload();
        engine = null;
        loadedModel = null;
        await deleteModelAllInfoInCache(message.model);
        send({id, type: "status", status: "deleted"});
        break;
      default:
        throw new Error(`Unknown request: ${type}`);
    }
  } catch (error) {
    send({id, type: "error", error: describe(error)});
  }
};
