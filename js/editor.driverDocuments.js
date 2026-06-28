// Fahrerunterlagen-Pakete aus gespeicherten Linienvarianten erstellen.
function getDriverDocumentsModal(title) {
  let modal = document.getElementById("driverDocumentsModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "driverDocumentsModal";
    modal.className = "help-modal hidden";
    modal.innerHTML = `
      <div class="help-modal-content driver-documents-modal-content">
        <div class="help-modal-header">
          <h3>Fahrerunterlagen erstellen</h3>
          <button type="button" class="driver-documents-close" aria-label="Schließen">×</button>
        </div>
        <div class="driver-documents-body"></div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector(".driver-documents-close").addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", event => {
      if (event.target === modal) modal.classList.add("hidden");
    });
  }
  modal.querySelector(".help-modal-header h3").textContent = title;
  return modal;
}

async function openDriverDocumentsDialog(options = {}) {
  const modal = getDriverDocumentsModal("Fahrerunterlagen erstellen");

  const body = modal.querySelector(".driver-documents-body");
  body.textContent = "Gespeicherte Linien werden geladen ...";
  modal.classList.remove("hidden");

  try {
    const response = await fetch(`${API_LIST_LINES_URL}?_ts=${Date.now()}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result?.ok || !Array.isArray(result.lines)) {
      throw new Error(result?.error || "Linienliste konnte nicht geladen werden.");
    }

    body.innerHTML = "";
    const driverLabel = document.createElement("label");
    driverLabel.className = "driver-documents-driver";
    const driverCaption = document.createElement("span");
    driverCaption.textContent = "Name Fahrer/in";
    const driverInput = document.createElement("input");
    driverInput.type = "text";
    driverInput.placeholder = "optional";
    driverInput.value = String(options.driverName || "");
    driverLabel.append(driverCaption, driverInput);

    const actions = document.createElement("div");
    actions.className = "driver-documents-selection-actions";
    const selectAllBtn = document.createElement("button");
    selectAllBtn.type = "button";
    selectAllBtn.textContent = "Alle auswählen";
    const selectNoneBtn = document.createElement("button");
    selectNoneBtn.type = "button";
    selectNoneBtn.textContent = "Keine auswählen";
    const selectStandardBtn = document.createElement("button");
    selectStandardBtn.type = "button";
    selectStandardBtn.textContent = "Standard auswählen";
    actions.append(selectStandardBtn, selectAllBtn, selectNoneBtn);

    const list = document.createElement("div");
    list.className = "driver-documents-list";
    const entries = result.lines.map(line => {
      const row = document.createElement("label");
      row.className = "driver-documents-entry";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      const selectedKeys = new Set((options.selectedItems || []).map(item =>
        [item.city, item.lineFolder, item.categoryFolder, item.fileBase].map(value => String(value || "")).join("|")
      ));
      const lineKey = [line.city, line.lineFolder, line.categoryFolder, line.fileBase]
        .map(value => String(value || ""))
        .join("|");
      checkbox.checked = selectedKeys.size
        ? selectedKeys.has(lineKey)
        : String(line.variantCategory || "Standard") === "Standard";
      const text = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = [line.lineName, line.variantName || line.routeName].filter(Boolean).join(" – ");
      const meta = document.createElement("small");
      meta.textContent = [
        line.city,
        line.routeName,
        line.directionName,
        line.variantCategory || "Standard"
      ].filter(Boolean).join(" | ");
      text.append(title, meta);
      row.append(checkbox, text);
      list.appendChild(row);
      return { line, checkbox };
    });

    const footer = document.createElement("div");
    footer.className = "driver-documents-footer";
    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "driver-documents-create";
    createBtn.textContent = "Paket erstellen";
    const status = document.createElement("span");
    footer.append(status, createBtn);

    const setSelection = predicate => entries.forEach(entry => {
      entry.checkbox.checked = predicate(entry.line);
    });
    selectAllBtn.addEventListener("click", () => setSelection(() => true));
    selectNoneBtn.addEventListener("click", () => setSelection(() => false));
    selectStandardBtn.addEventListener("click", () => setSelection(
      line => String(line.variantCategory || "Standard") === "Standard"
    ));

    createBtn.addEventListener("click", async () => {
      const selected = entries.filter(entry => entry.checkbox.checked);
      if (!selected.length) {
        status.textContent = "Bitte mindestens eine Unterlage auswählen.";
        return;
      }
      createBtn.disabled = true;
      status.textContent = "Paket wird erstellt ...";
      try {
        let packageMode = options.updatePackageId
          ? { mode: "update", packageId: options.updatePackageId }
          : { mode: "new", packageId: "" };
        if (!options.updatePackageId && driverInput.value.trim()) {
          const existingPackages = await fetchDriverPackages();
          const matchingPackages = existingPackages.filter(packageInfo =>
            String(packageInfo.driverName || "").trim().toLocaleLowerCase("de-DE")
              === driverInput.value.trim().toLocaleLowerCase("de-DE")
          );
          if (matchingPackages.length) {
            packageMode = await chooseDriverPackageMode(matchingPackages);
            if (!packageMode) {
              status.textContent = "Erstellung abgebrochen.";
              createBtn.disabled = false;
              return;
            }
          }
        }
        const packageResponse = await fetch("api/create_driver_documents.php", {
          method: "POST",
          headers: withApiAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            driverName: driverInput.value.trim(),
            mode: packageMode.mode,
            packageId: packageMode.packageId,
            items: selected.map(entry => ({
              city: entry.line.city,
              lineFolder: entry.line.lineFolder,
              categoryFolder: entry.line.categoryFolder,
              fileBase: entry.line.fileBase
            }))
          })
        });
        const packageResult = await packageResponse.json();
        if (!packageResponse.ok || !packageResult?.ok) {
          throw new Error(packageResult?.error || "Paket konnte nicht erstellt werden.");
        }
        renderDriverDocumentsResult(body, packageResult);
      } catch (error) {
        status.textContent = error.message || "Paket konnte nicht erstellt werden.";
        createBtn.disabled = false;
      }
    });

    body.append(driverLabel, actions, list, footer);
  } catch (error) {
    body.textContent = error.message || "Fahrerunterlagen konnten nicht vorbereitet werden.";
  }
}

async function fetchDriverPackages() {
  const response = await fetch("api/list_driver_packages.php", {
    cache: "no-store",
    headers: withApiAuthHeaders({})
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || "Einweisungspakete konnten nicht geladen werden.");
  }
  return Array.isArray(result.packages) ? result.packages : [];
}

function chooseDriverPackageMode(packages) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "driver-package-choice-overlay";
    const box = document.createElement("div");
    box.className = "driver-package-choice";
    const title = document.createElement("h4");
    title.textContent = "Für diesen Fahrer existieren bereits Einweisungspakete.";
    const updateLabel = document.createElement("label");
    const updateRadio = document.createElement("input");
    updateRadio.type = "radio";
    updateRadio.name = "driverPackageMode";
    updateRadio.value = "update";
    const packageSelect = document.createElement("select");
    packages.forEach(packageInfo => {
      const option = document.createElement("option");
      option.value = packageInfo.id;
      option.textContent = new Date(packageInfo.created || "").toLocaleString("de-DE");
      packageSelect.appendChild(option);
    });
    updateLabel.append(updateRadio, document.createTextNode(" Bestehendes Paket aktualisieren "), packageSelect);
    const newLabel = document.createElement("label");
    const newRadio = document.createElement("input");
    newRadio.type = "radio";
    newRadio.name = "driverPackageMode";
    newRadio.value = "new";
    newLabel.append(newRadio, document.createTextNode(" Neues Paket erstellen"));
    const cancelLabel = document.createElement("label");
    const cancelRadio = document.createElement("input");
    cancelRadio.type = "radio";
    cancelRadio.name = "driverPackageMode";
    cancelRadio.value = "cancel";
    cancelRadio.checked = true;
    cancelLabel.append(cancelRadio, document.createTextNode(" Abbrechen"));
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.textContent = "Weiter";
    confirmButton.addEventListener("click", () => {
      const selected = overlay.querySelector('input[name="driverPackageMode"]:checked')?.value;
      overlay.remove();
      if (selected === "update") resolve({ mode: "update", packageId: packageSelect.value });
      else if (selected === "new") resolve({ mode: "new", packageId: "" });
      else resolve(null);
    });
    box.append(title, updateLabel, newLabel, cancelLabel, confirmButton);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

async function openDriverPackagesDialog() {
  const modal = getDriverDocumentsModal("Einweisungspakete");
  const body = modal.querySelector(".driver-documents-body");
  body.textContent = "Einweisungspakete werden geladen ...";
  modal.classList.remove("hidden");

  try {
    body.innerHTML = "";
    const packages = await fetchDriverPackages();
    if (!packages.length) {
      body.textContent = "Noch keine Einweisungspakete vorhanden.";
      return;
    }

    const list = document.createElement("div");
    list.className = "driver-documents-packages";
    packages.forEach(packageInfo => {
      const card = document.createElement("div");
      card.className = "driver-documents-package-card";
      const text = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = packageInfo.driverName || "Unbenannt";
      const meta = document.createElement("small");
      const created = packageInfo.created
        ? new Date(packageInfo.created).toLocaleString("de-DE")
        : "";
      const updated = packageInfo.updated
        ? new Date(packageInfo.updated).toLocaleString("de-DE")
        : "";
      meta.textContent = `Erstellt: ${created} | Geändert: ${updated} | Status: ${packageInfo.status || "Erstellt"} | ${Number(packageInfo.documentCount || 0)} Unterlagen`;
      text.append(title, meta);
      const cardActions = document.createElement("div");
      cardActions.className = "driver-documents-card-actions";
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.textContent = "Öffnen";
      openButton.addEventListener("click", () => {
        renderDriverDocumentsResult(body, {
          package: packageInfo,
          packagePath: packageInfo.packagePath
        });
      });
      const pdfButton = document.createElement("button");
      pdfButton.type = "button";
      pdfButton.textContent = "PDF anzeigen";
      pdfButton.disabled = !packageInfo.documents?.length;
      pdfButton.addEventListener("click", () => {
        if (packageInfo.documents?.[0]?.path) window.open(packageInfo.documents[0].path, "_blank", "noopener");
      });
      const zipButton = document.createElement("button");
      zipButton.type = "button";
      zipButton.textContent = "ZIP herunterladen";
      zipButton.addEventListener("click", () => downloadDriverPackageZip(packageInfo.id, zipButton));
      const updateButton = document.createElement("button");
      updateButton.type = "button";
      updateButton.textContent = "Aktualisieren";
      updateButton.addEventListener("click", () => openDriverDocumentsDialog({
        updatePackageId: packageInfo.id,
        driverName: packageInfo.driverName,
        selectedItems: packageInfo.selectedItems
      }));
      const renameButton = document.createElement("button");
      renameButton.type = "button";
      renameButton.textContent = "Umbenennen";
      renameButton.addEventListener("click", async () => {
        const newName = prompt("Neuer Fahrername:", packageInfo.driverName || "");
        if (newName === null) return;
        try {
          await manageDriverPackage("rename", packageInfo.id, { driverName: newName.trim() });
          openDriverPackagesDialog();
        } catch (error) {
          alert(error.message || "Paket konnte nicht umbenannt werden.");
        }
      });
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "Löschen";
      deleteButton.addEventListener("click", async () => {
        if (!confirm("Einweisungspaket wirklich löschen?")) return;
        try {
          await manageDriverPackage("delete", packageInfo.id);
          openDriverPackagesDialog();
        } catch (error) {
          alert(error.message || "Paket konnte nicht gelöscht werden.");
        }
      });
      cardActions.append(openButton, pdfButton, zipButton, updateButton, renameButton, deleteButton);
      card.append(text, cardActions);
      list.appendChild(card);
    });
    body.appendChild(list);
  } catch (error) {
    body.textContent = error.message || "Einweisungspakete konnten nicht geladen werden.";
  }
}

async function manageDriverPackage(action, id, extra = {}) {
  const response = await fetch("api/manage_driver_package.php", {
    method: "POST",
    headers: withApiAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, id, ...extra })
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || "Paketaktion fehlgeschlagen.");
  }
  return result;
}

function renderDriverDocumentsResult(container, result) {
  container.innerHTML = "";
  const packageData = result.package || {};
  const heading = document.createElement("h4");
  heading.textContent = "Fahrerunterlagen-Paket";
  const meta = document.createElement("dl");
  meta.className = "driver-documents-package-meta";
  const createdAt = packageData.created || packageData.createdAt
    ? new Date(packageData.created || packageData.createdAt).toLocaleString("de-DE")
    : "";
  const updatedAt = packageData.updated
    ? new Date(packageData.updated).toLocaleString("de-DE")
    : createdAt;
  [
    ["Fahrer/in", packageData.driverName || "Unbenannt"],
    ["Erstellt", createdAt],
    ["Zuletzt geändert", updatedAt],
    ["Status", packageData.status || "Erstellt"],
    ["Unterlagen", String(Number(packageData.documentCount || 0))]
  ].forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    meta.append(term, description);
  });

  const toolbar = document.createElement("div");
  toolbar.className = "driver-documents-package-toolbar";
  const zipButton = document.createElement("button");
  zipButton.type = "button";
  zipButton.className = "driver-documents-create";
  zipButton.textContent = "Gesamtes Paket herunterladen";
  const zipStatus = document.createElement("span");
  zipButton.addEventListener("click", () => downloadDriverPackageZip(packageData.id, zipButton, zipStatus));
  toolbar.append(zipButton, zipStatus);

  const list = document.createElement("ul");
  list.className = "driver-documents-result-list";
  (packageData.documents || []).forEach(documentInfo => {
    const item = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = [
      documentInfo.lineName,
      documentInfo.variantName || documentInfo.routeName
    ].filter(Boolean).join(" – ");
    const link = document.createElement("a");
    link.href = documentInfo.path;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "driver-documents-open";
    link.textContent = "Öffnen";
    item.append(text, link);
    list.appendChild(item);
  });
  const savedHint = document.createElement("small");
  savedHint.className = "driver-documents-saved-hint";
  savedHint.textContent = "Paketdaten gespeichert";
  container.append(heading, meta, toolbar, list, savedHint);
}

async function downloadDriverPackageZip(packageId, button, statusElement = null) {
  button.disabled = true;
  if (statusElement) statusElement.textContent = "ZIP wird erstellt ...";
  try {
    const response = await fetch(
      `api/download_driver_package.php?id=${encodeURIComponent(packageId)}`,
      { headers: withApiAuthHeaders({}) }
    );
    if (!response.ok) {
      const errorResult = await response.json().catch(() => ({}));
      throw new Error(errorResult.error || "ZIP konnte nicht erstellt werden.");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const filename = encodedName ? decodeURIComponent(encodedName) : "Fahrerunterlagen.zip";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    if (statusElement) statusElement.textContent = "ZIP heruntergeladen.";
  } catch (error) {
    if (statusElement) {
      statusElement.textContent = error.message || "ZIP konnte nicht erstellt werden.";
    } else {
      alert(error.message || "ZIP konnte nicht erstellt werden.");
    }
  } finally {
    button.disabled = false;
  }
}
