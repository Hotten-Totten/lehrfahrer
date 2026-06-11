// =========================
// LINE BROWSER
// =========================
// Dieses Modul verwaltet den Linien-Browser
// Zeigt alle gespeicherten Linien vom Server an und ermöglicht Laden/Löschen/Umbenennen

let lineBrowserRequestSeq = 0;

// Schließt das Linien-Browser-Fenster
function closeLineBrowser() {
  lineBrowserModal.classList.add("hidden");
}

// Formatiert ein ISO-Datum für die Anzeige (deutsches Format)
function formatSavedAt(iso) {
  if (!iso) return "–";
  try {
    const d = new Date(iso);
    return d.toLocaleString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch { return iso; }
}

function isDiversionLine(line) {
  const fileBase = String(line?.fileBase || "");
  const routeName = String(line?.routeName || "");
  return /umleitung_\d{2}/i.test(fileBase) || /umleitung\s*_?\s*\d{2}/i.test(routeName);
}

// Rendert die Liste der Linien im Browser-Fenster
// Enthält Suche, Sortierung, Gruppenansicht nach Ort, Download-Buttons
function renderLineBrowser(lines) {
  lineBrowserBody.innerHTML = "";

  if (!lines || !lines.length) {
    const empty = document.createElement("div");
    empty.className = "line-browser-empty";
    empty.textContent = "Keine gespeicherten Linien gefunden.";
    lineBrowserBody.appendChild(empty);
    return;
  }

  let currentLines = Array.from(lines);

  // Toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "line-browser-toolbar";

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Linien filtern …";
  searchInput.className = "line-browser-search";
  searchInput.setAttribute("autocomplete", "off");

  const sortSelect = document.createElement("select");
  sortSelect.className = "line-browser-sort";
  [
    ["date-desc", "Neueste zuerst"],
    ["date-asc",  "Älteste zuerst"],
    ["name-asc",  "Name A–Z"]
  ].forEach(([val, label]) => {
    const opt = document.createElement("option");
    opt.value = val; opt.textContent = label;
    sortSelect.appendChild(opt);
  });

  toolbar.appendChild(searchInput);
  toolbar.appendChild(sortSelect);
  lineBrowserBody.appendChild(toolbar);

  const container = document.createElement("div");
  lineBrowserBody.appendChild(container);

  function getSortedFiltered() {
    const q = searchInput.value.toLowerCase().trim();
    const sort = sortSelect.value;
    let filtered = currentLines.filter(line => {
      if (!q) return true;
      return [line.lineName, line.routeName, line.directionName, line.city]
        .join(" ").toLowerCase().includes(q);
    });
    if (sort === "date-desc") filtered.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
    else if (sort === "date-asc") filtered.sort((a, b) => (a.savedAt || "").localeCompare(b.savedAt || ""));
    else filtered.sort((a, b) => (a.lineName || "").localeCompare(b.lineName || ""));
    return filtered;
  }

  function renderList() {
    container.innerHTML = "";
    const filtered = getSortedFiltered();
    if (!filtered.length) {
      container.innerHTML = '<div class="line-browser-empty">Keine Linien gefunden.</div>';
      return;
    }

    // Nach Ort gruppieren
    const groups = {};
    filtered.forEach(line => {
      const c = line.city || "unbekannt";
      if (!groups[c]) groups[c] = [];
      groups[c].push(line);
    });

    Object.keys(groups).sort().forEach(city => {
      const group = document.createElement("div");
      group.className = "line-browser-city-group";

      const heading = document.createElement("div");
      heading.className = "line-browser-city-heading";
      heading.textContent = city.charAt(0).toUpperCase() + city.slice(1) + " (" + groups[city].length + ")";
      group.appendChild(heading);

      const list = document.createElement("div");
      list.className = "line-browser-list";

      groups[city].forEach(line => {
        const item = document.createElement("div");
        item.className = "line-browser-item";

        // Farb-Badge
        const badge = document.createElement("div");
        badge.className = "line-browser-badge";
        badge.textContent = line.lineName || "?";
        if (line.color) {
          badge.style.background = line.color;
          // Dunkel-/Helligkeitsanpassung für Text
          const hex = line.color.replace("#", "");
          const r = parseInt(hex.substr(0,2),16), g = parseInt(hex.substr(2,2),16), b = parseInt(hex.substr(4,2),16);
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          badge.style.color = brightness > 128 ? "#1e293b" : "#fff";
        }

        // Info-Block
        const info = document.createElement("div");
        info.className = "line-browser-info";

        const title = document.createElement("div");
        title.className = "line-browser-title";
        title.textContent = [line.routeName, line.directionName].filter(Boolean).join(" – ") || "(ohne Bezeichnung)";

        const meta = document.createElement("div");
        meta.className = "line-browser-meta";
        const parts = [];
        if (line.stopCount != null) parts.push(line.stopCount + " Halt.");
        if (line.routeLengthMeters) parts.push((line.routeLengthMeters / 1000).toFixed(1) + " km");
        if (line.savedAt) parts.push(formatSavedAt(line.savedAt));
        meta.textContent = parts.join("  ·  ");

        // Datei-Badges (JSON / GPX / PDF)
        const fileBadges = document.createElement("div");
        fileBadges.className = "lbr-file-badges";
        const jsonBadge = document.createElement("span");
        jsonBadge.className = "lbr-file-badge lbr-file-badge-json";
        jsonBadge.textContent = "JSON";
        fileBadges.appendChild(jsonBadge);
        const gpxBadge = document.createElement("span");
        gpxBadge.className = "lbr-file-badge " + (line.hasGpx ? "lbr-file-badge-gpx" : "lbr-file-badge-missing");
        gpxBadge.textContent = line.hasGpx ? "GPX ✓" : "GPX fehlt";
        fileBadges.appendChild(gpxBadge);
        const pdfBadge = document.createElement("span");
        pdfBadge.className = "lbr-file-badge " + (line.hasPdf ? "lbr-file-badge-gpx" : "lbr-file-badge-missing");
        pdfBadge.textContent = line.hasPdf ? "PDF ✓" : "PDF fehlt";
        fileBadges.appendChild(pdfBadge);
        if (isDiversionLine(line)) {
          const diversionBadge = document.createElement("span");
          diversionBadge.className = "lbr-file-badge lbr-file-badge-diversion";
          diversionBadge.textContent = "Umleitung";
          fileBadges.appendChild(diversionBadge);
        }

        info.appendChild(title);
        info.appendChild(meta);
        info.appendChild(fileBadges);

        // Aktions-Buttons
        const actions = document.createElement("div");
        actions.className = "line-browser-actions";

        function makeBtn(text, cls) {
          const btn = document.createElement("button");
          btn.type = "button"; btn.className = "lbr-btn " + cls; btn.textContent = text;
          return btn;
        }

        const loadBtn    = makeBtn("Laden", "lbr-btn-load");
        const dlJsonBtn  = makeBtn("↓ JSON", "lbr-btn-download");
        const renameBtn  = makeBtn("Umbenennen", "lbr-btn-rename");
        const deleteBtn  = makeBtn("Löschen", "lbr-btn-delete");

        actions.appendChild(loadBtn);
        actions.appendChild(dlJsonBtn);
        if (line.hasGpx) {
          const dlGpxBtn = makeBtn("↓ GPX", "lbr-btn-download");
          dlGpxBtn.addEventListener("click", e => {
            e.stopPropagation();
            const a = document.createElement("a");
            a.href = line.lineFolder
              ? "linien/" + encodeURIComponent(line.city) + "/" + encodeURIComponent(line.lineFolder) + "/" + encodeURIComponent(line.fileBase) + ".gpx"
              : "linien/" + encodeURIComponent(line.city) + "/gpx/" + encodeURIComponent(line.fileBase) + ".gpx";
            a.download = line.fileBase + ".gpx";
            document.body.appendChild(a); a.click(); a.remove();
          });
          actions.appendChild(dlGpxBtn);
        }
        if (line.hasPdf) {
          const dlPdfBtn = makeBtn("↓ PDF", "lbr-btn-download");
          dlPdfBtn.addEventListener("click", e => {
            e.stopPropagation();
            const params = new URLSearchParams();
            params.set("city", line.city || "cottbus");
            params.set("line", line.fileBase || line.id || "");
            if (line.lineFolder) {
              params.set("lineFolder", line.lineFolder);
            }
            const a = document.createElement("a");
            a.href = "api/download_line_pdf.php?" + params.toString();
            a.download = (line.fileBase || line.id || "linie") + ".pdf";
            document.body.appendChild(a); a.click(); a.remove();
          });
          actions.appendChild(dlPdfBtn);
        }
        actions.appendChild(renameBtn);
        actions.appendChild(deleteBtn);

        // Hauptzeile
        const mainRow = document.createElement("div");
        mainRow.className = "line-browser-main";
        mainRow.appendChild(badge);
        mainRow.appendChild(info);
        mainRow.appendChild(actions);

        // Umbenennen-Formular
        const renameForm = document.createElement("div");
        renameForm.className = "line-browser-rename-form hidden";
        function makeField(labelText, value) {
          const label = document.createElement("label");
          label.className = "lbr-field-label";
          const span = document.createElement("span"); span.textContent = labelText + ": ";
          const input = document.createElement("input"); input.type = "text"; input.value = value; input.className = "lbr-field-input";
          label.appendChild(span); label.appendChild(input);
          return { label, input };
        }
        const f_line  = makeField("Linie",   line.lineName || "");
        const f_route = makeField("Route",   line.routeName || "");
        const f_dir   = makeField("Richtung",line.directionName || "");
        const renameSaveBtn   = makeBtn("Speichern", "lbr-btn-save");
        const renameCancelBtn = makeBtn("Abbrechen", "lbr-btn-cancel");
        [f_line.label, f_route.label, f_dir.label, renameSaveBtn, renameCancelBtn]
          .forEach(el => renameForm.appendChild(el));

        // Löschen-Bestätigung
        const deleteConfirm = document.createElement("div");
        deleteConfirm.className = "line-browser-delete-confirm hidden";
        const confirmText = document.createElement("span"); confirmText.textContent = "Linie wirklich löschen?";
        const confirmYes = makeBtn("Ja, löschen", "lbr-btn-delete");
        const confirmNo  = makeBtn("Abbrechen", "lbr-btn-cancel");
        [confirmText, confirmYes, confirmNo].forEach(el => deleteConfirm.appendChild(el));

        // Events
        loadBtn.addEventListener("click", async e => {
          e.stopPropagation(); closeLineBrowser();
          await loadLineFromServer(line.fileBase || line.id, line.lineFolder || null);
        });

        dlJsonBtn.addEventListener("click", e => {
          e.stopPropagation();
          const a = document.createElement("a");
          a.href = line.lineFolder
            ? "linien/" + encodeURIComponent(line.city) + "/" + encodeURIComponent(line.lineFolder) + "/" + encodeURIComponent(line.fileBase) + ".json"
            : "linien/" + encodeURIComponent(line.city) + "/" + encodeURIComponent(line.fileBase) + ".json";
          a.download = line.fileBase + ".json";
          document.body.appendChild(a); a.click(); a.remove();
        });

        renameBtn.addEventListener("click", e => {
          e.stopPropagation();
          renameForm.classList.toggle("hidden");
          deleteConfirm.classList.add("hidden");
          if (!renameForm.classList.contains("hidden")) f_line.input.focus();
        });

        renameSaveBtn.addEventListener("click", async () => {
          renameSaveBtn.disabled = true; renameSaveBtn.textContent = "Speichern …";
          const ok = await renameLineOnServer(line, f_line.input.value.trim(), f_route.input.value.trim(), f_dir.input.value.trim());
          if (ok) {
            line.lineName = f_line.input.value.trim();
            line.routeName = f_route.input.value.trim();
            line.directionName = f_dir.input.value.trim();
            renderList();
          } else { renameSaveBtn.disabled = false; renameSaveBtn.textContent = "Speichern"; }
        });

        renameCancelBtn.addEventListener("click", () => renameForm.classList.add("hidden"));

        deleteBtn.addEventListener("click", e => {
          e.stopPropagation();
          deleteConfirm.classList.toggle("hidden");
          renameForm.classList.add("hidden");
        });

        confirmYes.addEventListener("click", async () => {
          const deleted = await deleteLineFromServer(line.fileBase || line.id, true, line.lineFolder || null);
          if (deleted) { currentLines = currentLines.filter(l => (l.fileBase || l.id) !== (line.fileBase || line.id)); renderList(); }
          else deleteConfirm.classList.add("hidden");
        });

        confirmNo.addEventListener("click", () => deleteConfirm.classList.add("hidden"));

        item.appendChild(mainRow);
        item.appendChild(renameForm);
        item.appendChild(deleteConfirm);
        list.appendChild(item);
      });

      group.appendChild(list);
      container.appendChild(group);
    });
  }

  searchInput.addEventListener("input", renderList);
  sortSelect.addEventListener("change", renderList);
  renderList();
}

// Öffnet den Linien-Browser und lädt die Linienliste vom Server
async function openLineBrowser() {
  const requestSeq = ++lineBrowserRequestSeq;
  const city = String(citySelect?.value || "").trim();

  lineBrowserModal.classList.remove("hidden");
  lineBrowserBody.innerHTML = `<div class="line-browser-empty">Lade gespeicherte Linien${city ? " für " + city : ""}…</div>`;

  const lines = await fetchLineListFromServer();

  // Falls zwischenzeitlich erneut geöffnet/aktualisiert wurde: veraltetes Ergebnis ignorieren.
  if (requestSeq !== lineBrowserRequestSeq) {
    return;
  }

  if (!lines.length) {
    lineBrowserBody.innerHTML =
      '<div class="line-browser-empty">Keine gespeicherten Linien auf dem Server gefunden.</div>';
    setStatus("Keine gespeicherten Linien gefunden.", "warn");
    return;
  }

  renderLineBrowser(lines);
  setStatus("Linien-Browser geöffnet.");
}

// Refresh-Button
(function () {
  const refreshBtn = document.getElementById("lineBrowserRefreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => openLineBrowser());
  }
})();