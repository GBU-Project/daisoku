"use strict";

/* ==================== UTILS & STORAGE ==================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const STORE_KEY = "scanumkm.items.v1";
const OPTS_KEY = "scanumkm.opts.v2";

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

function loadItems() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function saveItems() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); }
  catch { toast("Penyimpanan lokal penuh"); }
}

function loadOpts() {
  try {
    return JSON.parse(localStorage.getItem(OPTS_KEY)) || { continuous: true, beep: true };
  } catch {
    return { continuous: true, beep: true };
  }
}
function saveOpts() {
  try {
    localStorage.setItem(OPTS_KEY, JSON.stringify({
      continuous: $("#opt-continuous").checked,
      beep: $("#opt-beep").checked,
    }));
  } catch {}
}

let items = loadItems();
const savedOpts = loadOpts();

// Inisialisasi opsi toggle
if ($("#opt-continuous")) $("#opt-continuous").checked = savedOpts.continuous ?? true;
if ($("#opt-beep")) $("#opt-beep").checked = savedOpts.beep ?? true;

$("#opt-continuous").addEventListener("change", () => {
  saveOpts();
  toast($("#opt-continuous").checked ? "Mode: Scan Beruntun Aktif" : "Mode: Scan Satuan Aktif");
});
$("#opt-beep").addEventListener("change", saveOpts);

/* ==================== AUDIO & VIBRATION ==================== */
let audioCtx;
function feedback() {
  if ($("#opt-beep").checked) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = 1400;
      g.gain.value = 0.12;
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.1);
    } catch {}
  }
  try { navigator.vibrate && navigator.vibrate(60); } catch {}
}

/* ==================== SCANNER ==================== */
let scanner = null, scanning = false;
let cameras = [], camIndex = 0, torchOn = false;
let lastCode = "", lastAt = 0;

const FORMATS = () => {
  const F = Html5QrcodeSupportedFormats;
  return [
    F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E,
    F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.CODABAR,
    F.DATA_MATRIX, F.PDF_417, F.AZTEC
  ];
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

function setStatus(msg, active = false) {
  const el = $("#cam-status-text");
  if (el) el.textContent = msg;
  const frame = $("#cam-frame");
  if (frame) frame.classList.toggle("active", active);
}

function setScanBtn(isScanning) {
  const btn = $("#btn-scan");
  const lbl = $("#fab-label");
  if (!btn) return;
  if (isScanning) {
    btn.classList.add("stop");
    if (lbl) lbl.textContent = "STOP";
    btn.querySelector(".fab-icon").textContent = "⏹";
  } else {
    btn.classList.remove("stop");
    if (lbl) lbl.textContent = "SCAN";
    btn.querySelector(".fab-icon").textContent = "▣";
  }
}

async function startScan() {
  if (scanning) return;
  if (!window.isSecureContext) { toast("Kamera memerlukan HTTPS / localhost"); return; }

  setStatus("Membuka kamera…");
  const s = getScanner();
  try {
    if (!cameras.length) cameras = await Html5Qrcode.getCameras();
  } catch {}

  const cfg = {
    fps: 15,
    qrbox: (w, h) => {
      const side = Math.floor(Math.min(w, h) * 0.72);
      return { width: Math.floor(side * 1.35) > w ? side : Math.floor(side * 1.35), height: side };
    },
    aspectRatio: 16 / 9,
  };

  const source = (camIndex > 0 && cameras[camIndex])
    ? cameras[camIndex].id
    : { facingMode: "environment" };

  try {
    await s.start(source, cfg, onDecoded, () => {});
    scanning = true;
    setScanBtn(true);
    setStatus("🟢 Arahkan ke barcode / QR", true);
    setupTorch();
    $("#btn-switch").hidden = cameras.length < 2;
  } catch (e) {
    const msg = String(e && e.message || e);
    const err = /permission|denied|NotAllowed/i.test(msg)
      ? "❌ Izin kamera ditolak di browser"
      : "❌ Kamera tidak dapat dibuka";
    setStatus(err, false);
    toast(err);
  }
}

async function stopScan() {
  if (!scanner || !scanning) return;
  try { await scanner.stop(); scanner.clear(); } catch {}
  scanning = false; torchOn = false;
  setScanBtn(false);
  setStatus("⏸ Dijeda — Tekan SCAN untuk lanjut", false);
  $("#btn-torch").hidden = true;
  $("#btn-torch").classList.remove("on");
  $("#btn-switch").hidden = true;
}

function setupTorch() {
  try {
    const cap = scanner.getRunningTrackCameraCapabilities();
    $("#btn-torch").hidden = !(cap && cap.torchFeature && cap.torchFeature().isSupported());
  } catch {
    $("#btn-torch").hidden = true;
  }
}

$("#btn-torch").addEventListener("click", async () => {
  try {
    torchOn = !torchOn;
    await scanner.getRunningTrackCameraCapabilities().torchFeature().apply(torchOn);
    $("#btn-torch").classList.toggle("on", torchOn);
  } catch {
    torchOn = false;
    toast("Senter tidak didukung pada kamera ini");
  }
});

$("#btn-switch").addEventListener("click", async () => {
  if (cameras.length < 2) return;
  camIndex = (camIndex + 1) % cameras.length;
  await stopScan();
  await startScan();
});

/* Tombol Besar SCAN (FAB) */
$("#btn-scan").addEventListener("click", () => scanning ? stopScan() : startScan());

/* ==================== DECODE HANDLER ==================== */
let pendingSingleItem = null;

function onDecoded(text) {
  const now = Date.now();
  // Cegah scan ganda berturut-turut pada kode yang sama dalam 1.3 detik
  if (text === lastCode && now - lastAt < 1300) return;
  lastCode = text;
  lastAt = now;

  feedback();

  const isContinuous = $("#opt-continuous").checked;

  if (isContinuous) {
    // Mode Beruntun: Otomatis tambah QTY & kamera terus jalan
    addOrIncrement(text, 1);
  } else {
    // Mode Satuan (Unchecked): Hentikan scan & buka dialog konfirmasi QTY
    stopScan();
    openSingleScanDialog(text);
  }
}

function addOrIncrement(code, qtyToAdd = 1) {
  const existing = items.find(i => i.code === code);
  if (existing) {
    existing.qty += qtyToAdd;
    existing.at = new Date().toISOString();
    toast(`＋${qtyToAdd} → ${code} (QTY: ${existing.qty})`);
  } else {
    items.unshift({
      id: uid(),
      code: code,
      qty: qtyToAdd,
      at: new Date().toISOString()
    });
    toast(`✔ Ditambah: ${code}`);
  }
  saveItems();
  renderList();
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/* ==================== DIALOG SINGLE SCAN ==================== */
function openSingleScanDialog(code) {
  pendingSingleItem = code;
  $("#single-code").textContent = code;
  $("#single-qty").value = 1;
  const d = $("#single-scan-dialog");
  if (!d.open) d.showModal();
  setTimeout(() => {
    const inp = $("#single-qty");
    inp.select && inp.select();
  }, 80);
}

$("#single-scan-dialog").addEventListener("close", () => {
  const d = $("#single-scan-dialog");
  if (d.returnValue === "save" && pendingSingleItem) {
    const qty = Math.max(1, parseInt($("#single-qty").value) || 1);
    addOrIncrement(pendingSingleItem, qty);
  }
  d.returnValue = "";
  pendingSingleItem = null;
});

/* ==================== RENDER LIST ==================== */
function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
}

function renderList() {
  const ul = $("#item-list");
  ul.replaceChildren();

  const totalQty = items.reduce((acc, it) => acc + (parseInt(it.qty) || 0), 0);
  $("#item-count").textContent = items.length ? `(${items.length} item / ${totalQty} pcs)` : "";
  $("#list-empty").hidden = items.length > 0;

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "item-row";

    const info = document.createElement("div");
    info.className = "item-info";
    info.innerHTML =
      `<div class="item-code">${escHtml(item.code)}</div>` +
      `<div class="item-sub">${fmtDate(item.at)}</div>`;

    const qtyEl = document.createElement("div");
    qtyEl.className = "qty-tap";
    qtyEl.textContent = item.qty;
    qtyEl.title = "Tap untuk koreksi QTY";
    qtyEl.addEventListener("click", () => openEditDialog(item));

    li.append(info, qtyEl);
    ul.append(li);
  }
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

renderList();

/* ==================== DIALOG: EDIT QTY ==================== */
let editTarget = null;

function openEditDialog(item) {
  editTarget = item;
  $("#edit-code").textContent = item.code;
  $("#edit-qty").value = item.qty;
  const d = $("#edit-dialog");
  if (!d.open) d.showModal();
  setTimeout(() => {
    const inp = $("#edit-qty");
    inp.select && inp.select();
  }, 80);
}

$("#edit-dialog").addEventListener("close", () => {
  const d = $("#edit-dialog");
  if (d.returnValue !== "save" || !editTarget) {
    editTarget = null;
    return;
  }
  const qty = parseInt($("#edit-qty").value);
  if (isNaN(qty) || qty <= 0) {
    items = items.filter(i => i.id !== editTarget.id);
    toast("Item dihapus dari daftar");
  } else {
    editTarget.qty = qty;
    editTarget.at = new Date().toISOString();
    toast(`QTY diubah: ${qty}`);
  }
  editTarget = null;
  saveItems();
  renderList();
  d.returnValue = "";
});

/* ==================== DIALOG: TAMBAH MANUAL ==================== */
$("#btn-add").addEventListener("click", () => {
  $("#add-code").value = "";
  $("#add-qty").value = 1;
  const d = $("#add-dialog");
  if (!d.open) d.showModal();
  setTimeout(() => $("#add-code").focus(), 80);
});

$("#add-dialog").addEventListener("close", () => {
  const d = $("#add-dialog");
  if (d.returnValue !== "save") return;
  const code = $("#add-code").value.trim();
  if (!code) return;
  const qty = Math.max(1, parseInt($("#add-qty").value) || 1);
  addOrIncrement(code, qty);
  d.returnValue = "";
});

/* Helper Tombol Plus / Minus */
function bindSpinner(minusId, plusId, fieldId, minVal = 0) {
  $(minusId).addEventListener("click", () => {
    const inp = $(fieldId);
    const v = parseInt(inp.value) || 0;
    if (v > minVal) inp.value = v - 1;
  });
  $(plusId).addEventListener("click", () => {
    const inp = $(fieldId);
    inp.value = (parseInt(inp.value) || 0) + 1;
  });
}
bindSpinner("#add-minus", "#add-plus", "#add-qty", 1);
bindSpinner("#edit-minus", "#edit-plus", "#edit-qty", 0);
bindSpinner("#single-minus", "#single-plus", "#single-qty", 1);

/* ==================== LAYER EKSPOR & CADANGAN ==================== */
const exportDlg = $("#export-dialog");

$("#btn-open-export").addEventListener("click", () => {
  const totalQty = items.reduce((acc, it) => acc + (parseInt(it.qty) || 0), 0);
  $("#sum-items").textContent = items.length;
  $("#sum-qty").textContent = totalQty;
  if (!exportDlg.open) exportDlg.showModal();
});

$("#btn-close-export").addEventListener("click", () => exportDlg.close());

function triggerDownload(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* 1. Ekspor ke Excel (.xlsx) */
$("#btn-export-xlsx").addEventListener("click", () => {
  if (!items.length) return toast("Belum ada data untuk diekspor");

  const today = new Date().toISOString().slice(0, 10);
  const filename = `scan-umkm-${today}.xlsx`;

  try {
    if (typeof XLSX !== "undefined") {
      const data = items.map((it, idx) => ({
        "No": idx + 1,
        "Kode / Barcode": it.code,
        "QTY": it.qty,
        "Waktu Scan": fmtDate(it.at)
      }));

      const ws = XLSX.utils.json_to_sheet(data);

      // Auto width kolom
      ws["!cols"] = [
        { wch: 6 },
        { wch: 25 },
        { wch: 10 },
        { wch: 20 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Hasil Scan");
      XLSX.writeFile(wb, filename);

      toast(`Excel (.xlsx) berhasil diunduh (${items.length} item)`);
      exportDlg.close();
      return;
    }
  } catch (err) {
    console.warn("SheetJS error, fallback to CSV:", err);
  }

  // Fallback jika lib XLSX gagal
  doExportCSV();
  exportDlg.close();
});

/* 2. Ekspor ke CSV (.csv) */
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function doExportCSV() {
  if (!items.length) return toast("Belum ada data untuk diekspor");
  const today = new Date().toISOString().slice(0, 10);
  const lines = [["No", "Kode / Barcode", "QTY", "Waktu Scan"].map(csvCell).join(",")];
  items.forEach((it, idx) => {
    lines.push([idx + 1, it.code, it.qty, fmtDate(it.at)].map(csvCell).join(","));
  });
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `scan-umkm-${today}.csv`);
  toast(`CSV berhasil diunduh (${items.length} item)`);
}

$("#btn-export-csv").addEventListener("click", () => {
  doExportCSV();
  exportDlg.close();
});

/* 3. Cadangan JSON (.json) */
$("#btn-export-json").addEventListener("click", () => {
  if (!items.length) return toast("Belum ada data untuk dicadangkan");
  const today = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
  triggerDownload(blob, `backup-scan-umkm-${today}.json`);
  toast(`Backup JSON berhasil diunduh`);
  exportDlg.close();
});

/* 4. Pulihkan / Impor JSON */
$("#btn-import-trigger").addEventListener("click", () => $("#import-input").click());

$("#import-input").addEventListener("change", e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error("Format JSON bukan array");

      let added = 0;
      const ids = new Set(items.map(i => i.id));

      for (const item of data) {
        if (item && item.code && !ids.has(item.id)) {
          items.push({
            id: item.id || uid(),
            code: String(item.code),
            qty: parseInt(item.qty) || 1,
            at: item.at || new Date().toISOString()
          });
          added++;
        }
      }

      items.sort((a, b) => new Date(b.at) - new Date(a.at));
      saveItems();
      renderList();
      exportDlg.close();
      toast(`✔ ${added} item berhasil dipulihkan`);
    } catch {
      toast("❌ File backup tidak valid");
    }
  };
  reader.readAsText(f);
});

/* ==================== HAPUS SEMUA ==================== */
$("#btn-clear").addEventListener("click", () => {
  if (!items.length) return toast("Daftar sudah kosong");
  if (confirm("Hapus SEMUA riwayat item? Tindakan ini tidak dapat dibatalkan.")) {
    items = [];
    saveItems();
    renderList();
    toast("Semua data telah dibersihkan");
  }
});

/* ==================== PWA SERVICE WORKER ==================== */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopScan();
});

/* Auto-start saat halaman pertama dibuka */
window.addEventListener("load", () => {
  setTimeout(() => startScan(), 300);
});
