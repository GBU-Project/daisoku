"use strict";

/* ===== Utils ===== */
const $ = (s, el = document) => el.querySelector(s);
const STORE_KEY = "scanumkm.items.v1";

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2000);
}

function loadItems() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function saveItems() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); }
  catch { toast("Penyimpanan penuh"); }
}

/* items: [{ id, code, qty, at }] */
let items = loadItems();

/* ===== Scanner ===== */
let scanner = null, scanning = false;
let cameras = [], camIndex = 0, torchOn = false;
let lastCode = "", lastAt = 0;

const FORMATS = () => {
  const F = Html5QrcodeSupportedFormats;
  return [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E,
    F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.CODABAR,
    F.DATA_MATRIX, F.PDF_417, F.AZTEC];
};

function getScanner() {
  if (!scanner) scanner = new Html5Qrcode("reader", {
    formatsToSupport: FORMATS(), useBarCodeDetectorIfSupported: true, verbose: false
  });
  return scanner;
}

async function startScan() {
  if (scanning) return;
  if (!window.isSecureContext) { toast("Butuh HTTPS atau localhost"); return; }
  const s = getScanner();
  try { if (!cameras.length) cameras = await Html5Qrcode.getCameras(); } catch {}
  const cfg = {
    fps: 15,
    qrbox: (w, h) => { const side = Math.floor(Math.min(w, h) * 0.6); return { width: side, height: side }; },
    aspectRatio: 16 / 9,
  };
  const source = (camIndex > 0 && cameras[camIndex]) ? cameras[camIndex].id : { facingMode: "environment" };
  try {
    await s.start(source, cfg, onDecoded, () => {});
    scanning = true;
    const btn = $("#btn-start");
    btn.textContent = "⏹ Berhenti";
    btn.classList.add("stop");
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
  const btn = $("#btn-start");
  btn.textContent = "▶ Mulai Scan";
  btn.classList.remove("stop");
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
  await stopScan(); await startScan();
});

$("#btn-start").addEventListener("click", () => scanning ? stopScan() : startScan());

/* ===== Decode handler ===== */
function onDecoded(text) {
  const now = Date.now();
  if (text === lastCode && now - lastAt < 1500) return;
  lastCode = text; lastAt = now;

  try { navigator.vibrate && navigator.vibrate(60); } catch {}

  /* Cek apakah kode sudah ada */
  const existing = items.find(i => i.code === text);
  if (existing) {
    existing.qty += 1;
    existing.at = new Date().toISOString();
    toast("＋1 → " + text + "  (QTY: " + existing.qty + ")");
  } else {
    items.unshift({ id: uid(), code: text, qty: 1, at: new Date().toISOString() });
    toast("Ditambah: " + text);
  }
  saveItems();
  renderList();
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/* ===== Render list ===== */
function fmtDate(iso) {
  try { return new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }); }
  catch { return ""; }
}

function renderList() {
  const ul = $("#item-list");
  ul.replaceChildren();
  $("#item-count").textContent = items.length ? "(" + items.length + ")" : "";
  $("#list-empty").hidden = items.length > 0;

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "item-row";

    const info = document.createElement("div");
    info.className = "item-code";
    info.innerHTML = `<div>${escHtml(item.code)}</div><div class="item-sub">${fmtDate(item.at)}</div>`;

    /* QTY — tap to edit */
    const qtyWrap = document.createElement("div");
    qtyWrap.className = "item-qty-wrap";
    const qtyEl = document.createElement("div");
    qtyEl.className = "qty-tap";
    qtyEl.textContent = item.qty;
    qtyEl.title = "Tap untuk koreksi QTY";
    qtyEl.addEventListener("click", () => openEditDialog(item));
    qtyWrap.append(qtyEl);

    li.append(info, qtyWrap);
    ul.append(li);
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

renderList();

/* ===== Dialog: Add manual ===== */
$("#btn-add").addEventListener("click", () => {
  $("#add-code").value = "";
  $("#add-qty").value = 1;
  if (!$("#add-dialog").open) $("#add-dialog").showModal();
  setTimeout(() => $("#add-code").focus(), 80);
});

$("#add-minus").addEventListener("click", () => {
  const inp = $("#add-qty");
  if ((parseInt(inp.value) || 1) > 1) inp.value = (parseInt(inp.value) || 1) - 1;
});
$("#add-plus").addEventListener("click", () => {
  $("#add-qty").value = (parseInt($("#add-qty").value) || 0) + 1;
});

$("#add-dialog").addEventListener("close", () => {
  if ($("#add-dialog").returnValue !== "save") return;
  const code = $("#add-code").value.trim();
  if (!code) return;
  const qty = Math.max(1, parseInt($("#add-qty").value) || 1);
  const existing = items.find(i => i.code === code);
  if (existing) {
    existing.qty += qty;
    existing.at = new Date().toISOString();
    toast("Updated: " + code + "  QTY: " + existing.qty);
  } else {
    items.unshift({ id: uid(), code, qty, at: new Date().toISOString() });
    toast("Ditambah: " + code);
  }
  saveItems(); renderList();
  $("#add-dialog").returnValue = "";
});

/* ===== Dialog: Edit QTY ===== */
let editTarget = null;

function openEditDialog(item) {
  editTarget = item;
  $("#edit-code").textContent = item.code;
  $("#edit-qty").value = item.qty;
  if (!$("#edit-dialog").open) $("#edit-dialog").showModal();
  setTimeout(() => { const inp = $("#edit-qty"); inp.select && inp.select(); }, 80);
}

$("#edit-minus").addEventListener("click", () => {
  const inp = $("#edit-qty");
  const v = parseInt(inp.value) || 0;
  if (v > 0) inp.value = v - 1;
});
$("#edit-plus").addEventListener("click", () => {
  $("#edit-qty").value = (parseInt($("#edit-qty").value) || 0) + 1;
});

$("#edit-dialog").addEventListener("close", () => {
  if ($("#edit-dialog").returnValue !== "save" || !editTarget) { editTarget = null; return; }
  const qty = parseInt($("#edit-qty").value) || 0;
  if (qty <= 0) {
    items = items.filter(i => i.id !== editTarget.id);
    toast("Item dihapus");
  } else {
    editTarget.qty = qty;
    editTarget.at = new Date().toISOString();
    toast("QTY diperbarui: " + qty);
  }
  editTarget = null;
  saveItems(); renderList();
  $("#edit-dialog").returnValue = "";
});

/* ===== Clear all ===== */
$("#btn-clear").addEventListener("click", () => {
  if (!items.length) return;
  if (confirm("Hapus semua item? Tidak bisa dikembalikan.")) {
    items = []; saveItems(); renderList();
  }
});

/* ===== Export CSV ===== */
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function triggerDownload(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

$("#btn-export").addEventListener("click", () => {
  if (!items.length) return toast("Belum ada data");
  const lines = [["Waktu", "Kode", "QTY"].map(csvCell).join(",")];
  for (const i of items)
    lines.push([fmtDate(i.at), i.code, i.qty].map(csvCell).join(","));
  triggerDownload(
    new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }),
    "scan-umkm-" + new Date().toISOString().slice(0, 10) + ".csv"
  );
  toast("CSV diunduh (" + items.length + " item)");
});

$("#btn-export-json").addEventListener("click", () => {
  if (!items.length) return toast("Belum ada data");
  triggerDownload(
    new Blob([JSON.stringify(items, null, 2)], { type: "application/json" }),
    "scan-umkm-" + new Date().toISOString().slice(0, 10) + ".json"
  );
  toast("JSON diunduh (" + items.length + " item)");
});

/* ===== Import JSON ===== */
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
      const ids = new Set(items.map(i => i.id));
      for (const item of data) {
        if (item && item.code && !ids.has(item.id)) {
          items.push({ id: item.id || uid(), code: String(item.code),
            qty: parseInt(item.qty) || 1, at: item.at || new Date().toISOString() });
          added++;
        }
      }
      items.sort((a, b) => new Date(b.at) - new Date(a.at));
      saveItems(); renderList();
      toast(added + " item diimpor");
    } catch { toast("File tidak valid"); }
  };
  reader.readAsText(f);
});

/* ===== PWA ===== */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
document.addEventListener("visibilitychange", () => { if (document.hidden) stopScan(); });
