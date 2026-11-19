"use strict";

/* ---------- Utils ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const STORE_KEY = "scanumkm.history.v2";

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function saveHistory() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(history)); }
  catch { toast("Penyimpanan penuh"); }
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

/* ---------- Scanner ---------- */
let scanner = null, scanning = false;
let cameras = [], camIndex = 0, torchOn = false;
let lastCode = "", lastAt = 0;

const FORMATS = () => {
  const F = Html5QrcodeSupportedFormats;
  return [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E,
    F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.CODABAR, F.DATA_MATRIX, F.PDF_417, F.AZTEC];
};

function getScanner() {
  if (!scanner) scanner = new Html5Qrcode("reader", { formatsToSupport: FORMATS(), useBarCodeDetectorIfSupported: true, verbose: false });
  return scanner;
}

async function startScan() {
  if (scanning) return;
  if (!window.isSecureContext) { toast("Kamera butuh HTTPS atau localhost"); return; }
  const s = getScanner();
  try { if (!cameras.length) cameras = await Html5Qrcode.getCameras(); } catch {}
  const cfg = { fps: 12, qrbox: (w, h) => { const side = Math.floor(Math.min(w, h) * 0.72); return { width: side, height: side }; }, aspectRatio: 1 };
  const source = (camIndex > 0 && cameras[camIndex]) ? cameras[camIndex].id : { facingMode: "environment" };
  try {
    await s.start(source, cfg, onDecoded, () => {});
    scanning = true;
    $("#btn-start").textContent = "⏹ Berhenti";
    $("#scan-hint").hidden = false;
    setupTorch();
    $("#btn-switch").hidden = cameras.length < 2;
  } catch (e) {
    const msg = String(e && e.message || e);
    toast(/permission|denied|NotAllowed/i.test(msg) ? "Izin kamera ditolak" : "Kamera tidak bisa dibuka");
  }
}

async function stopScan() {
  if (!scanner || !scanning) return;
  try { await scanner.stop(); scanner.clear(); } catch {}
  scanning = false; torchOn = false;
  $("#btn-start").textContent = "▶ Mulai Scan";
  $("#btn-torch").hidden = true;
  $("#btn-torch").classList.remove("on");
  $("#btn-switch").hidden = true;
  $("#scan-hint").hidden = true;
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
  await stopScan(); await startScan();
});

$("#btn-start").addEventListener("click", () => scanning ? stopScan() : startScan());

function onDecoded(text, result) {
  const now = Date.now();
  if (text === lastCode && now - lastAt < 2500) return;
  lastCode = text; lastAt = now;
  try { navigator.vibrate && navigator.vibrate(80); } catch {}
  const format = result?.result?.format?.formatName || "Barcode";
  stopScan();
  openQtyDialog({ text, format });
}

/* Scan dari foto */
$("#btn-file").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  await stopScan();
  try {
    const res = await getScanner().scanFileV2(f, false);
    openQtyDialog({ text: res.decodedText, format: res.result.format.formatName });
  } catch { toast("Kode tidak ditemukan pada foto"); }
});

/* Input manual */
$("#manual-form").addEventListener("submit", e => {
  e.preventDefault();
  const v = $("#manual-input").value.trim();
  if (!v) return;
  $("#manual-input").value = "";
  openQtyDialog({ text: v, format: "Manual" });
});

/* ---------- Dialog QTY ---------- */
let currentScan = null;

function openQtyDialog(scan) {
  currentScan = scan;
  $("#dlg-format").textContent = scan.format;
  $("#dlg-code").textContent = scan.text;
  $("#qty-input").value = 1;
  $("#dlg-note").value = "";
  const d = $("#qty-dialog");
  if (!d.open) d.showModal();
  setTimeout(() => $("#qty-input").select(), 100);
}

/* Tombol +/- QTY */
$("#qty-minus").addEventListener("click", () => {
  const inp = $("#qty-input");
  const v = parseInt(inp.value) || 1;
  if (v > 1) inp.value = v - 1;
});
$("#qty-plus").addEventListener("click", () => {
  const inp = $("#qty-input");
  inp.value = (parseInt(inp.value) || 0) + 1;
});

/* Simpan dari dialog */
$("#qty-dialog").addEventListener("close", () => {
  const d = $("#qty-dialog");
  if (d.returnValue === "save" && currentScan) {
    const qty = Math.max(1, parseInt($("#qty-input").value) || 1);
    const note = $("#dlg-note").value.trim();
    addEntry({ text: currentScan.text, format: currentScan.format, qty, note });
    toast("✔ Tersimpan — QTY: " + qty);
  }
  d.returnValue = "";
  currentScan = null;
});

/* ---------- Riwayat ---------- */
function addEntry({ text, format, qty, note }) {
  history.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    text, format, qty: qty || 1, note: note || "", at: new Date().toISOString()
  });
  if (history.length > 5000) history.length = 5000;
  saveHistory();
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
}

function renderHistory() {
  const q = $("#search").value.trim().toLowerCase();
  const rows = q ? history.filter(h => h.text.toLowerCase().includes(q) || (h.note || "").toLowerCase().includes(q)) : history;
  const ul = $("#history-list");
  ul.replaceChildren();
  $("#history-empty").hidden = rows.length > 0;
  $("#history-count").textContent = rows.length ? rows.length + " item" : "";

  for (const h of rows) {
    const li = document.createElement("li");
    li.className = "item";

    const info = document.createElement("div"); info.className = "item-info";
    const code = document.createElement("div"); code.className = "item-code"; code.textContent = h.text;
    const meta = document.createElement("div"); meta.className = "item-meta";
    meta.textContent = h.format + " · " + fmtDate(h.at);
    info.append(code, meta);
    if (h.note) {
      const n = document.createElement("div"); n.className = "item-note"; n.textContent = h.note;
      info.append(n);
    }

    const qty = document.createElement("div"); qty.className = "item-qty"; qty.textContent = h.qty || 1;

    const acts = document.createElement("div"); acts.className = "item-acts";
    const bEdit = mkBtn("✏ Edit", () => {
      const nqty = prompt("Ubah QTY untuk:\n" + h.text, h.qty || 1);
      if (nqty !== null) {
        h.qty = Math.max(1, parseInt(nqty) || 1);
        saveHistory(); renderHistory();
      }
    });
    const bDel = mkBtn("🗑", () => {
      history = history.filter(x => x.id !== h.id); saveHistory(); renderHistory();
    });
    bDel.classList.add("del");
    acts.append(bEdit, bDel);

    li.append(info, qty, acts);
    ul.append(li);
  }
}

function mkBtn(label, fn) {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = label; b.addEventListener("click", fn);
  return b;
}

$("#search").addEventListener("input", renderHistory);

$("#btn-clear").addEventListener("click", () => {
  if (!history.length) return;
  if (confirm("Hapus semua riwayat? Tidak bisa dikembalikan.")) {
    history = []; saveHistory(); renderHistory();
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

$("#btn-export-csv").addEventListener("click", () => {
  const rows = getExportRows();
  if (!rows.length) return toast("Riwayat kosong");
  const lines = [["Waktu", "Kode", "Jenis", "QTY", "Catatan"].map(csvCell).join(",")];
  for (const h of rows)
    lines.push([fmtDate(h.at), h.text, h.format, h.qty || 1, h.note || ""].map(csvCell).join(","));
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, "scan-umkm-" + new Date().toISOString().slice(0, 10) + ".csv");
  toast("CSV diunduh (" + rows.length + " data)");
});

$("#btn-export-json").addEventListener("click", () => {
  const rows = getExportRows();
  if (!rows.length) return toast("Riwayat kosong");
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  triggerDownload(blob, "scan-umkm-" + new Date().toISOString().slice(0, 10) + ".json");
  toast("JSON diunduh (" + rows.length + " data)");
});

$("#btn-import").addEventListener("click", () => $("#import-input").click());
$("#import-input").addEventListener("change", e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error();
      let added = 0;
      const ids = new Set(history.map(h => h.id));
      for (const item of data) {
        if (item && item.text && item.at && !ids.has(item.id)) {
          history.push({ id: item.id, text: String(item.text), format: String(item.format || "Import"),
            qty: parseInt(item.qty) || 1, note: String(item.note || ""), at: item.at });
          added++;
        }
      }
      history.sort((a, b) => new Date(b.at) - new Date(a.at));
      saveHistory(); renderHistory();
      toast(added + " data berhasil diimpor");
    } catch { toast("File tidak valid"); }
  };
  reader.readAsText(f);
});

/* ---------- PWA ---------- */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

document.addEventListener("visibilitychange", () => { if (document.hidden) stopScan(); });
