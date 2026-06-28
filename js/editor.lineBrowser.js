// =========================
// LINE BROWSER
// =========================
// Dieses Modul verwaltet den Linien-Browser
// Zeigt alle gespeicherten Linien vom Server an und ermöglicht Laden/Löschen/Umbenennen

let lineBrowserRequestSeq = 0;
let lineBrowserSelectedCity = "";

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

function getLineBrowserVariantName(line) {
  const explicit = String(line?.variantName || "").trim();
  if (explicit) return explicit;
  return [line?.routeName, line?.directionName].filter(Boolean).join(" - ") || "Standard";
}

function getLineBrowserVariantCategory(line) {
  return String(line?.variantCategory || "").trim() || "Standard";
}

function getLineBrowserLineValue(line) {
  const folderName = String(line?.lineFolder || "").trim().replace(/^Linie[_\s-]*/i, "");
  return folderName || String(line?.lineName || "").trim() || "Unbekannt";
}

function getLineBrowserLineLabel(line) {
  const value = getLineBrowserLineValue(line);
  return /^Linie\b/i.test(value) ? value : "Linie " + value;
}

function createLineBrowserGroup(className, label, count, open) {
  const details = document.createElement("details");
  details.className = "line-browser-tree-group " + className;
  details.open = open;

  const summary = document.createElement("summary");
  summary.className = "line-browser-tree-summary";

  const labelNode = document.createElement("span");
  labelNode.className = "line-browser-tree-label";
  labelNode.textContent = label;

  const countNode = document.createElement("span");
  countNode.className = "line-browser-tree-count";
  countNode.textContent = "(" + count + (count === 1 ? " Variante)" : " Varianten)");

  summary.appendChild(labelNode);
  summary.appendChild(countNode);
  details.appendChild(summary);

  const content = document.createElement("div");
  content.className = "line-browser-tree-content";
  details.appendChild(content);
  return { details, content };
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

  const cityFilterSelect = document.createElement("select");
  cityFilterSelect.className = "line-browser-sort";
  const currentCityValue = String(citySelect?.value || "").trim();
  const cityValues = Array.from(new Set(currentLines.map(line => String(line.city || "").trim()).filter(Boolean))).sort();
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "Alle Städte";
  cityFilterSelect.appendChild(allOpt);
  cityValues.forEach(city => {
    const opt = document.createElement("option");
    opt.value = city;
    opt.textContent = city.charAt(0).toUpperCase() + city.slice(1);
    cityFilterSelect.appendChild(opt);
  });
  const preferredCityValue = String(lineBrowserSelectedCity || currentCityValue || "").trim();
  cityFilterSelect.value = cityValues.includes(preferredCityValue) ? preferredCityValue : "";
  lineBrowserSelectedCity = cityFilterSelect.value || "";

  toolbar.appendChild(searchInput);
  toolbar.appendChild(cityFilterSelect);
  toolbar.appendChild(sortSelect);
  lineBrowserBody.appendChild(toolbar);

  const container = document.createElement("div");
  lineBrowserBody.appendChild(container);

  function getSortedFiltered() {
    const q = searchInput.value.toLowerCase().trim();
    const sort = sortSelect.value;
    let filtered = currentLines.filter(line => {
      if (lineBrowserSelectedCity && String(line.city || "").trim() !== lineBrowserSelectedCity) {
        return false;
      }
      if (!q) return true;
      return [line.lineName, line.routeName, line.directionName, line.description, line.variantName, line.variantCategory, line.city]
        .join(" ").toLowerCase().includes(q);
    });
    filtered.sort((a, b) => {
      const lineCompare = (a.lineName || "").localeCompare(b.lineName || "");
      if (lineCompare !== 0) return lineCompare;
      const categoryCompare = getLineBrowserVariantCategory(a).localeCompare(getLineBrowserVariantCategory(b));
      if (categoryCompare !== 0) return categoryCompare;
      if (sort === "date-desc") return (b.savedAt || "").localeCompare(a.savedAt || "");
      if (sort === "date-asc") return (a.savedAt || "").localeCompare(b.savedAt || "");
      return getLineBrowserVariantName(a).localeCompare(getLineBrowserVariantName(b));
    });
    return filtered;
  }

  function renderList() {
    container.innerHTML = "";
    const filtered = getSortedFiltered();
    if (!filtered.length) {
      container.innerHTML = '<div class="line-browser-empty">Keine Linien gefunden.</div>';
      return;
    }

    const groups = new Map();
    filtered.forEach(line => {
      const city = String(line.city || "Unbekannt").trim() || "Unbekannt";
      const lineKey = String(line.lineFolder || line.lineName || "Unbekannt").trim() || "Unbekannt";
      const category = getLineBrowserVariantCategory(line);
      if (!groups.has(city)) groups.set(city, new Map());
      const cityGroup = groups.get(city);
      if (!cityGroup.has(lineKey)) cityGroup.set(lineKey, new Map());
      const lineGroup = cityGroup.get(lineKey);
      if (!lineGroup.has(category)) lineGroup.set(category, []);
      lineGroup.get(category).push(line);
    });

    const searchActive = Boolean(searchInput.value.trim());
    Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, "de")).forEach(city => {
      const cityGroups = groups.get(city);
      const cityCount = Array.from(cityGroups.values()).reduce(
        (sum, lineGroups) => sum + Array.from(lineGroups.values()).reduce((lineSum, entries) => lineSum + entries.length, 0),
        0
      );
      const cityTree = createLineBrowserGroup(
        "line-browser-city-group",
        city.charAt(0).toUpperCase() + city.slice(1),
        cityCount,
        true
      );

      Array.from(cityGroups.keys()).sort((a, b) => a.localeCompare(b, "de", { numeric: true })).forEach(lineKey => {
        const categoryGroups = cityGroups.get(lineKey);
        const lineCount = Array.from(categoryGroups.values()).reduce((sum, entries) => sum + entries.length, 0);
        const firstLine = Array.from(categoryGroups.values())[0][0];
        const lineTree = createLineBrowserGroup(
          "line-browser-line-group",
          getLineBrowserLineLabel(firstLine),
          lineCount,
          searchActive || cityGroups.size === 1
        );

        Array.from(categoryGroups.keys()).sort((a, b) => a.localeCompare(b, "de")).forEach(category => {
          const categoryLines = categoryGroups.get(category);
          const categoryTree = createLineBrowserGroup(
            "line-browser-category-group",
            category,
            categoryLines.length,
            searchActive
          );
          const list = document.createElement("div");
          list.className = "line-browser-list";

          categoryLines.forEach(line => {

        const item = document.createElement("div");
        item.className = "line-browser-item";

        // Farb-Badge
        const badge = document.createElement("div");
        badge.className = "line-browser-badge";
        badge.textContent = getLineBrowserLineValue(line);
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
        title.textContent = "Variante: " + getLineBrowserVariantName(line);

        const meta = document.createElement("div");
        meta.className = "line-browser-meta";
        const parts = [];
        const routeAndDirection = [line.routeName, line.directionName].filter(Boolean).join(" – ");
        if (routeAndDirection) parts.push(routeAndDirection);
        if (line.stopCount != null) parts.push(line.stopCount + " Halt.");
        if (line.routeLengthMeters) parts.push((line.routeLengthMeters / 1000).toFixed(1) + " km");
        if (line.savedAt) parts.push(formatSavedAt(line.savedAt));
        meta.textContent = parts.join("  ·  ");

        const descriptionText = String(line.description || "").trim();
        const description = document.createElement("div");
        description.className = "line-browser-description";
        description.textContent = descriptionText || "Keine Bemerkung";
        if (!descriptionText) {
          description.classList.add("line-browser-description-empty");
        }

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
        info.appendChild(description);
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
              ? "linien/" + encodeURIComponent(line.city) + "/" + encodeURIComponent(line.lineFolder) + "/" + (line.categoryFolder ? encodeURIComponent(line.categoryFolder) + "/" : "") + encodeURIComponent(line.fileBase) + ".gpx"
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
            if (line.categoryFolder) {
              params.set("categoryFolder", line.categoryFolder);
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
          e.stopPropagation();
          closeLineBrowser();
          if (citySelect && line.city) {
            citySelect.value = line.city;
          }
          await loadLineFromServer(line.fileBase || line.id, line.lineFolder || null, line.city || null, line.categoryFolder || null);
        });

        dlJsonBtn.addEventListener("click", e => {
          e.stopPropagation();
          const a = document.createElement("a");
          a.href = line.lineFolder
            ? "linien/" + encodeURIComponent(line.city) + "/" + encodeURIComponent(line.lineFolder) + "/" + (line.categoryFolder ? encodeURIComponent(line.categoryFolder) + "/" : "") + encodeURIComponent(line.fileBase) + ".json"
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
          const deleted = await deleteLineFromServer(line.fileBase || line.id, true, line.lineFolder || null, line.city || null, line.categoryFolder || null);
          if (deleted) {
            currentLines = currentLines.filter(l =>
              (l.fileBase || l.id) !== (line.fileBase || line.id) ||
              (l.lineFolder || null) !== (line.lineFolder || null) ||
              (l.categoryFolder || null) !== (line.categoryFolder || null)
            );
            renderList();
          }
          else deleteConfirm.classList.add("hidden");
        });

        confirmNo.addEventListener("click", () => deleteConfirm.classList.add("hidden"));

        item.appendChild(mainRow);
        item.appendChild(renameForm);
        item.appendChild(deleteConfirm);
            list.appendChild(item);
          });

          categoryTree.content.appendChild(list);
          lineTree.content.appendChild(categoryTree.details);
        });

        cityTree.content.appendChild(lineTree.details);
      });

      container.appendChild(cityTree.details);
    });
  }

  searchInput.addEventListener("input", renderList);
  cityFilterSelect.addEventListener("change", () => {
    lineBrowserSelectedCity = cityFilterSelect.value || "";
    renderList();
  });
  sortSelect.addEventListener("change", renderList);
  renderList();
}

// Öffnet den Linien-Browser und lädt die Linienliste vom Server
async function openLineBrowser() {
  const requestSeq = ++lineBrowserRequestSeq;
  const city = "";

  lineBrowserModal.classList.remove("hidden");
  lineBrowserBody.innerHTML = `<div class="line-browser-empty">Lade gespeicherte Linien aller Städte…</div>`;

  const lines = await fetchLineListFromServer(city);

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

  const rebuildBtn = document.getElementById("lineBrowserRebuildPdfBtn");
  if (rebuildBtn) {
    rebuildBtn.addEventListener("click", async () => {
      const city = String(lineBrowserSelectedCity || "").trim();
      const scopeText = city ? `für ${city}` : "für alle Städte";
      const ok = confirm(`Fehlende PDF- und GPX-Dateien ${scopeText} jetzt nacherzeugen?`);
      if (!ok) return;

      rebuildBtn.disabled = true;
      const prevText = rebuildBtn.textContent;
      rebuildBtn.textContent = "Dateien werden erstellt…";

      try {
        const response = await fetch("api/regenerate_pdfs.php", {
          method: "POST",
          headers: withApiAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ city })
        });

        const result = await response.json();
        if (!response.ok || !result.ok) {
          throw new Error(result.error || "PDF-Nacherzeugung fehlgeschlagen");
        }

        setStatus(`Nacherzeugung fertig: PDF ${result.generatedPdfCount || 0}, GPX ${result.generatedGpxCount || 0} von ${result.totalLines} Linien (${result.cityScope || "alle Städte"})`);
        await openLineBrowser();
      } catch (err) {
        error("PDF-Nacherzeugung fehlgeschlagen", err);
        setStatus(err.message || "Datei-Nacherzeugung fehlgeschlagen.", "error");
      } finally {
        rebuildBtn.disabled = false;
        rebuildBtn.textContent = prevText;
      }
    });
  }

  const normalizeGhostBtn = document.getElementById("lineBrowserNormalizeGhostBtn");
  if (normalizeGhostBtn) {
    normalizeGhostBtn.addEventListener("click", async () => {
      const city = String(lineBrowserSelectedCity || "").trim();
      const scopeText = city ? `für ${city}` : "für alle Städte";
      const ok = confirm(`Alte freie Standardpunkte ${scopeText} jetzt als Ghostpunkte bereinigen?`);
      if (!ok) return;

      normalizeGhostBtn.disabled = true;
      const prevText = normalizeGhostBtn.textContent;
      normalizeGhostBtn.textContent = "Ghostpunkte werden bereinigt…";

      try {
        const response = await fetch("api/normalize_ghost_points.php", {
          method: "POST",
          headers: withApiAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ city })
        });

        const result = await response.json();
        if (!response.ok || !result.ok) {
          throw new Error(result.error || "Ghostpunkt-Bereinigung fehlgeschlagen");
        }

        setStatus(`Ghostpunkt-Bereinigung fertig: ${result.modifiedStopCount || 0} Stops in ${result.modifiedLineCount || 0} Linien (${result.cityScope || "alle Städte"})`);
        await openLineBrowser();
      } catch (err) {
        error("Ghostpunkt-Bereinigung fehlgeschlagen", err);
        setStatus(err.message || "Ghostpunkt-Bereinigung fehlgeschlagen.", "error");
      } finally {
        normalizeGhostBtn.disabled = false;
        normalizeGhostBtn.textContent = prevText;
      }
    });
  }
})();
