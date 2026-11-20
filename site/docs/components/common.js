

export const num = new Intl.NumberFormat("en-US");

export const families = ["ML-KEM", "ML-DSA", "SLH-DSA", "LMS", "XMSS", "PQC"];

export const familyColors = new Map([
  ["ML-KEM", "#4e79a7"],
  ["ML-DSA", "#f28e2b"],
  ["SLH-DSA", "#59a14f"],
  ["LMS", "#b07aa1"],
  ["XMSS", "#76b7b2"],
  ["PQC", "#9c755f"],
]);

export function splitList(value) {
  return (value || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isValidated(d) {
  return d.source === "CMVP" || (d.source === "CAVP" && d.status === "none_yet");
}

export function productKey(d) {
  return `${d.source}|${d.record_id}|${d.vendor}|${d.product}`;
}

export function osLabel(d) {
  if (d.os_name) return d.os_name;
  return d.os_family === "none" ? "(no OS / bare metal)" : "(unknown OS)";
}

export function targetKey(d) {
  return `${osLabel(d)} \u00b7 ${d.arch}`;
}

export function quarterOf(iso) {
  if (!iso || iso.length < 7) return null;
  const year = iso.slice(0, 4);
  const month = Number(iso.slice(5, 7));
  if (!year || !month) return null;
  return `${year} Q${Math.floor((month - 1) / 3) + 1}`;
}

export function sourceLabel(source) {
  const labels = {
    CAVP: "CAVP",
    CMVP: "CMVP",
    "CMVP-MIP": "CMVP in progress",
    "CMVP-IUT": "CMVP in progress",
  };
  return labels[source] ?? source;
}

export function downloadLink(file, label) {
  const a = document.createElement("a");
  a.href = file.href;
  a.textContent = label ?? file.name;
  a.download = file.name;
  return a;
}

export const moduleKinds = new Map([
  ["Software", "software"],
  ["Software-hybrid", "software_hybrid"],
  ["Firmware", "firmware"],
  ["Firmware-hybrid", "firmware_hybrid"],
  ["Hardware", "hardware"]
]);

export const softwareKinds = "('software', 'software_hybrid')";
