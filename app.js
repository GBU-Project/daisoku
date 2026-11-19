"use strict";

/* ---------- Util ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const STORE_KEY = "scanumkm.history.v1";
const OPT_KEY = "scanumkm.opts.v1";

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2000);
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function saveHistory(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); }
  catch { toast("Penyimpanan penuh atau diblokir browser"); }
}
function loadOpts() {
  try { return JSON.parse(localStorage.getItem(OPT_KEY)) || {}; } catch { return {}; }
}
function saveOpts() {
  try {
    localStorage.setItem(OPT_KEY, JSON.stringify({
      continuous: $("#opt-continuous").checked,
      beep: $("#opt-beep").checked,
    }));
  } catch { /* abaikan */ }
}

let history = loadHistory();

/* ---------- Tab ---------- */
function showTab(name) {
  $$(".tab").forEach(t => t.classList.toggle("active", t.id === "tab-" + name));
  $$(".tabbar button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  if (name !== "scan") stopScan();
  if (name === "history") renderHistory();
}
$$(".tabbar button").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));

/* ---------- Bunyi & getar ---------- */
let audioCtx;
function feedback() {
  if (!$("#opt-beep").checked) return;
  try { navigator.vibrate && navigator.vibrate(80); } catch { /* abaikan */ }
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "square"; o.frequency.value = 1100;
    g.gain.value = 0.08;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.12);
  } catch { /* abaikan */ }
}

/* ---------- Scanner ---------- */
let scanner = null;
let scanning = false;
let cameras = [];
let camIndex = 0;
let torchOn = false;
let lastCode = "", lastAt = 0;

const FORMATS = () => {
  const F = Html5QrcodeSupportedFormats;
  return [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93,
    F.ITF, F.CODABAR, F.DATA_MATRIX, F.PDF_417, F.AZTEC];
};

function getScanner() {
  if (!scanner) {
    scanner = new Html5Qrcode("reader", {
      formatsToSupport: FORMATS(),
      useBarCodeDetectorIfSupported: true,
      verbose: false,
    });
  }
  return scanner;
}

async function startScan() {
  if (scanning) return;
  if (!window.isSecureContext) {
    toast("Kamera butuh HTTPS atau localhost");
    return;
  }
  const s = getScanner();
  try {
    if (!cameras.length) cameras = await Html5Qrcode.getCameras();
  } catch { /* izin akan diminta saat start */ }
  const cfg = {
    fps: 12,
    qrbox: (w, h) => {
      const side = Math.floor(Math.min(w, h) * 0.7);
      return { width: Math.floor(side * 1.2) > w ? side : Math.floor(side * 1.2), height: side };
    },
    aspectRatio: 1,
  };
  const source = (camIndex > 0 && cameras[camIndex])
    ? cameras[camIndex].id
    : { facingMode: "environment" };
  try {
    await s.start(source, cfg, onDecoded, () => {});
    scanning = true;
    $("#btn-start").textContent = "Berhenti";
    $("#scan-hint").hidden = false;
    setupTorch();
    $("#btn-switch").hidden = cameras.length < 2;
  } catch (e) {
    scanning = false;
    const msg = String(e && e.message || e);
    toast(/permission|denied|NotAllowed/i.test(msg)
      ? "Izin kamera ditolak. Aktifkan di pengaturan browser."
      : "Kamera tidak bisa dibuka");
  }
}

async function stopScan() {
  if (!scanner || !scanning) return;
  try { await scanner.stop(); scanner.clear(); } catch { /* abaikan */ }
  scanning = false;
  torchOn = false;
  $("#btn-start").textContent = "Mulai Scan";
  $("#btn-torch").hidden = true;
  $("#btn-torch").classList.remove("on");
  $("#btn-switch").hidden = true;
}

function setupTorch() {
  try {
    const cap = scanner.getRunningTrackCameraCapabilities();
    $("#btn-torch").hidden = !(cap && cap.torchFeature && cap.torchFeature().isSupported());
  } catch { $("#btn-torch").hidden = true; }
}

$("#btn-torch").addEventListener("click", async () => {
  try {
    torchOn = !torchOn;
    await scanner.getRunningTrackCameraCapabilities().torchFeature().apply(torchOn);
    $("#btn-torch").classList.toggle("on", torchOn);
  } catch { torchOn = false; toast("Senter tidak didukung"); }
});

$("#btn-switch").addEventListener("click", async () => {
  if (cameras.length < 2) return;
  camIndex = (camIndex + 1) % cameras.length;
  await stopScan();
  await startScan();
});

$("#btn-start").addEventListener("click", () => (scanning ? stopScan() : startScan()));

function onDecoded(text, result) {
  const now = Date.now();
  if (text === lastCode && now - lastAt < 2500) return;
  lastCode = text; lastAt = now;
  const format = result && result.result && result.result.format && result.result.format.formatName || "Barcode";
  feedback();
  if ($("#opt-continuous").checked) {
    addEntry({ text, format, note: "" });
    toast("Tersimpan: " + text);
  } else {
    stopScan();
    openResult({ text, format });
  }
}

$("#btn-file").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", async e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  await stopScan();
  try {
    const res = await getScanner().scanFileV2(f, false);
    feedback();
    openResult({ text: res.decodedText, format: res.result.format.formatName });
  } catch {
    toast("Kode tidak ditemukan pada foto");
  }
});

$("#manual-form").addEventListener("submit", e => {
  e.preventDefault();
  const v = $("#manual-input").value.trim();
  if (!v) return;
  $("#manual-input").value = "";
  openResult({ text: v, format: "Manual" });
});

$("#opt-continuous").addEventListener("change", saveOpts);
$("#opt-beep").addEventListener("change", saveOpts);
{
  const o = loadOpts();
  if (typeof o.continuous === "boolean") $("#opt-continuous").checked = o.continuous;
  if (typeof o.beep === "boolean") $("#opt-beep").checked = o.beep;
}

/* ---------- Dialog hasil ---------- */
let current = null;
function openResult(r) {
  current = r;
  $("#res-format").textContent = r.format;
  $("#res-text").textContent = r.text;
  $("#res-note").value = "";
  const link = $("#res-link");
  if (/^https?:\/\//i.test(r.text)) {
    link.href = r.text; link.hidden = false;
  } else { link.hidden = true; link.removeAttribute("href"); }
  const d = $("#result-dialog");
  if (!d.open) d.showModal();
}

$("#res-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(current.text); toast("Disalin"); }
  catch { toast("Gagal menyalin"); }
});

$("#result-dialog").addEventListener("close", () => {
  const d = $("#result-dialog");
  if (d.returnValue === "save" && current) {
    addEntry({ text: current.text, format: current.format, note: $("#res-note").value.trim() });
    toast("Tersimpan ke riwayat");
  }
  d.returnValue = "";
  current = null;
});

/* ---------- Riwayat ---------- */
function addEntry({ text, format, note }) {
  history.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text, format, note, at: new Date().toISOString() });
  if (history.length > 5000) history.length = 5000;
  saveHistory(history);
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  } catch { return iso; }
}

function renderHistory() {
  const q = $("#search").value.trim().toLowerCase();
  const rows = q ? history.filter(h => h.text.toLowerCase().includes(q) || (h.note || "").toLowerCase().includes(q)) : history;
  const ul = $("#history");
  ul.replaceChildren();
  $("#history-empty").hidden = rows.length > 0;
  $("#history-count").textContent = rows.length ? rows.length + " hasil" : "";
  for (const h of rows) {
    const li = document.createElement("li");
    li.className = "item";
    const code = document.createElement("div"); code.className = "code"; code.textContent = h.text;
    const meta = document.createElement("div"); meta.className = "meta"; meta.textContent = h.format + " · " + fmtDate(h.at);
    li.append(code, meta);
    if (h.note) { const n = document.createElement("div"); n.className = "note"; n.textContent = h.note; li.append(n); }
    const acts = document.createElement("div"); acts.className = "acts";
    const bCopy = btn("Salin", async () => { try { await navigator.clipboard.writeText(h.text); toast("Disalin"); } catch { toast("Gagal menyalin"); } });
    const bNote = btn("Catatan", () => {
      const v = prompt("Catatan untuk " + h.text, h.note || "");
      if (v !== null) { h.note = v.trim(); saveHistory(history); renderHistory(); }
    });
    const bDel = btn("Hapus", () => {
      history = history.filter(x => x.id !== h.id); saveHistory(history); renderHistory();
    });
    bDel.classList.add("del");
    acts.append(bCopy, bNote, bDel);
    li.append(acts);
    ul.append(li);
  }
}
function btn(label, fn) {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = label; b.addEventListener("click", fn);
  return b;
}
$("#search").addEventListener("input", renderHistory);

$("#btn-clear").addEventListener("click", () => {
  if (!history.length) return;
  if (confirm("Hapus semua riwayat scan? Tindakan ini tidak bisa dibatalkan.")) {
    history = []; saveHistory(history); renderHistory();
  }
});

/* ---------- Ekspor & Impor ---------- */
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function triggerDownload(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function getExportRows() {
  const q = $("#search").value.trim().toLowerCase();
  return q ? history.filter(h => h.text.toLowerCase().includes(q) || (h.note || "").toLowerCase().includes(q)) : history;
}

function doExportCSV(rows) {
  const lines = [["Waktu", "Kode", "Jenis", "Catatan"].map(csvCell).join(",")];
  for (const h of rows) lines.push([fmtDate(h.at), h.text, h.format, h.note || ""].map(csvCell).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, "riwayat-scan-" + new Date().toISOString().slice(0, 10) + ".csv");
  toast("CSV diunduh (" + rows.length + " data)");
}

function doExportJSON(rows) {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  triggerDownload(blob, "riwayat-scan-" + new Date().toISOString().slice(0, 10) + ".json");
  toast("JSON diunduh (" + rows.length + " data)");
}

$("#btn-export-csv").addEventListener("click", () => {
  const rows = getExportRows();
  if (!rows.length) return toast("Riwayat kosong");
  doExportCSV(rows);
});

$("#btn-export-json").addEventListener("click", () => {
  const rows = getExportRows();
  if (!rows.length) return toast("Riwayat kosong");
  doExportJSON(rows);
});

/* Impor dari JSON */
$("#btn-import").addEventListener("click", () => $("#import-input").click());
$("#import-input").addEventListener("change", e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error("bukan array");
      let added = 0;
      const existingIds = new Set(history.map(h => h.id));
      for (const item of data) {
        if (item && item.text && item.at && !existingIds.has(item.id)) {
          history.push({
            id: item.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            text: String(item.text), format: String(item.format || "Import"),
            note: String(item.note || ""), at: item.at
          });
          added++;
        }
      }
      history.sort((a, b) => new Date(b.at) - new Date(a.at));
      saveHistory(history);
      renderHistory();
      toast(added + " data berhasil diimpor");
    } catch { toast("File tidak valid atau bukan JSON ekspor"); }
  };
  reader.readAsText(f);
});

/* ---------- Buat kode ---------- */
let genSvg = null;
function buildGenerated() {
  const type = $("#gen-type").value;
  const text = $("#gen-text").value;
  const label = $("#gen-label").value.trim();
  const box = $("#gen-preview");
  const err = $("#gen-error");
  box.replaceChildren(); genSvg = null; err.hidden = true;
  $("#btn-gen-save").disabled = $("#btn-gen-print").disabled = true;
  if (!text) return;
  try {
    let svgEl;
    if (type === "QR") {
      const qr = qrcode(0, "M");
      qr.addData(text); qr.make();
      const tmp = document.createElement("div");
      tmp.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      svgEl = tmp.firstElementChild;
    } else {
      svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      let valid = true;
      JsBarcode(svgEl, text, { format: type, displayValue: true, margin: 10, height: 90,
        fontSize: 16, background: "#ffffff", lineColor: "#000000",
        valid: ok => { valid = ok; } });
      if (!valid) throw new Error("invalid");
    }
    svgEl.style.background = "#fff";
    box.append(svgEl);
    if (label) { const l = document.createElement("div"); l.textContent = label;
      l.style.cssText = "color:#000;text-align:center;margin-top:8px;font-weight:600;word-break:break-word";
      const wrap = document.createElement("div"); wrap.style.textAlign = "center"; wrap.append(svgEl, l); box.replaceChildren(wrap); }
    genSvg = svgEl;
    $("#btn-gen-save").disabled = $("#btn-gen-print").disabled = false;
  } catch {
    err.textContent = hintFor(type);
    err.hidden = false;
  }
}
function hintFor(t) {
  return ({
    EAN13: "EAN-13 butuh 12 atau 13 angka.",
    EAN8: "EAN-8 butuh 7 atau 8 angka.",
    UPC: "UPC-A butuh 11 atau 12 angka.",
    CODE39: "Code 39 hanya huruf besar, angka, dan - . $ / + % spasi.",
  })[t] || "Isi tidak valid untuk jenis ini.";
}
["gen-type", "gen-text", "gen-label"].forEach(id => $("#" + id).addEventListener("input", buildGenerated));

$("#btn-gen-save").addEventListener("click", () => {
  if (!genSvg) return;
  const label = $("#gen-label").value.trim();
  const xml = new XMLSerializer().serializeToString(genSvg);
  const vb = genSvg.viewBox && genSvg.viewBox.baseVal;
  let w = parseFloat(genSvg.getAttribute("width")) || (vb && vb.width) || 300;
  let h = parseFloat(genSvg.getAttribute("height")) || (vb && vb.height) || 300;
  const scale = Math.max(1, Math.min(4, 800 / w));
  const pad = label ? 44 : 0;
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale); c.height = Math.round(h * scale + pad * scale / 2);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([xml.includes("xmlns=") ? xml : xml.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"')], { type: "image/svg+xml" }));
  img.onload = () => {
    ctx.drawImage(img, 0, 0, w * scale, h * scale);
    if (label) {
      ctx.fillStyle = "#000"; ctx.textAlign = "center"; ctx.font = "600 " + Math.round(16 * scale) + "px sans-serif";
      ctx.fillText(label, c.width / 2, h * scale + 22 * scale, c.width - 20);
    }
    URL.revokeObjectURL(url);
    c.toBlob(b => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = ($("#gen-text").value.replace(/[^\w-]+/g, "_").slice(0, 40) || "kode") + ".png";
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("Gagal membuat PNG"); };
  img.src = url;
});
$("#btn-gen-print").addEventListener("click", () => window.print());

/* ---------- PWA ---------- */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

document.addEventListener("visibilitychange", () => { if (document.hidden) stopScan(); });
