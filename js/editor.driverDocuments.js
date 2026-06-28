// Fahrerunterlagen-Pakete aus gespeicherten Linienvarianten erstellen.
async function openDriverDocumentsDialog() {
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
      checkbox.checked = String(line.variantCategory || "Standard") === "Standard";
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
        const packageResponse = await fetch("api/create_driver_documents.php", {
          method: "POST",
          headers: withApiAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            driverName: driverInput.value.trim(),
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

function renderDriverDocumentsResult(container, result) {
  container.innerHTML = "";
  const packageData = result.package || {};
  const heading = document.createElement("h4");
  heading.textContent = "Fahrerunterlagen-Paket";
  const meta = document.createElement("dl");
  meta.className = "driver-documents-package-meta";
  const createdAt = packageData.createdAt
    ? new Date(packageData.createdAt).toLocaleString("de-DE")
    : "";
  [
    ["Fahrer/in", packageData.driverName || "Unbenannt"],
    ["Erstellt", createdAt],
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
  zipButton.addEventListener("click", async () => {
    zipButton.disabled = true;
    zipStatus.textContent = "ZIP wird erstellt ...";
    try {
      const response = await fetch(
        `api/download_driver_package.php?package=${encodeURIComponent(result.packagePath)}`,
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
      zipStatus.textContent = "ZIP heruntergeladen.";
    } catch (error) {
      zipStatus.textContent = error.message || "ZIP konnte nicht erstellt werden.";
    } finally {
      zipButton.disabled = false;
    }
  });
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
