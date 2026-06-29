// Fahrerunterlagen-Pakete aus gespeicherten Linienvarianten erstellen.
const PERSON_ROLES = ["Admin", "Disponent", "Einweiser", "Fahrer"];

function getPersonRoles(person) {
  return Array.isArray(person?.roles) && person.roles.length ? person.roles : ["Fahrer"];
}

function hasPersonRole(person, role) {
  return getPersonRoles(person).includes(role);
}

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
    const drivers = await fetchDrivers().catch(() => []);
    const driverSelectLabel = document.createElement("label");
    driverSelectLabel.className = "driver-documents-driver";
    const driverSelectCaption = document.createElement("span");
    driverSelectCaption.textContent = "Fahrer auswählen";
    const driverSelect = document.createElement("select");
    const guestOption = document.createElement("option");
    guestOption.value = "";
    guestOption.textContent = "Gastfahrer / Freitext";
    driverSelect.appendChild(guestOption);
    drivers.filter(driver => driver.active !== false && hasPersonRole(driver, "Fahrer")).forEach(driver => {
      const option = document.createElement("option");
      option.value = driver.id;
      option.textContent = getDriverDisplayName(driver);
      option.dataset.driverName = getDriverFullName(driver);
      driverSelect.appendChild(option);
    });
    driverSelectLabel.append(driverSelectCaption, driverSelect);

    const driverLabel = document.createElement("label");
    driverLabel.className = "driver-documents-driver";
    const driverCaption = document.createElement("span");
    driverCaption.textContent = "Name Fahrer/in";
    const driverInput = document.createElement("input");
    driverInput.type = "text";
    driverInput.placeholder = "optional";
    driverInput.value = String(options.driverName || "");
    driverLabel.append(driverCaption, driverInput);
    driverSelect.addEventListener("change", () => {
      const option = driverSelect.selectedOptions[0];
      if (option?.value) driverInput.value = option.dataset.driverName || option.textContent || "";
    });
    const noteLabel = document.createElement("label");
    noteLabel.className = "driver-documents-driver";
    const noteCaption = document.createElement("span");
    noteCaption.textContent = "Bemerkung zum Paket";
    const noteInput = document.createElement("textarea");
    noteInput.placeholder = "optional";
    noteInput.value = String(options.note || "");
    noteLabel.append(noteCaption, noteInput);

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
            driverId: driverSelect.value || "",
            note: noteInput.value.trim(),
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

    body.append(driverSelectLabel, driverLabel, noteLabel, actions, list, footer);
  } catch (error) {
    body.textContent = error.message || "Fahrerunterlagen konnten nicht vorbereitet werden.";
  }
}

function getDriverDisplayName(driver) {
  const name = getDriverFullName(driver);
  return driver.personnelNumber ? `${name} (${driver.personnelNumber})` : name;
}

function getDriverFullName(driver) {
  return [driver.firstName, driver.lastName].filter(Boolean).join(" ").trim();
}

async function fetchDrivers() {
  const response = await fetch("api/drivers.php", {
    cache: "no-store",
    headers: withApiAuthHeaders({})
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || "Fahrerliste konnte nicht geladen werden.");
  }
  return Array.isArray(result.drivers) ? result.drivers : [];
}

async function saveDriverAction(payload) {
  const response = await fetch("api/drivers.php", {
    method: "POST",
    headers: withApiAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || "Fahreraktion fehlgeschlagen.");
  }
  return result;
}

async function openDriversDialog() {
  const modal = getDriverDocumentsModal("Personalverwaltung");
  const body = modal.querySelector(".driver-documents-body");
  body.textContent = "Personalverwaltung wird geladen ...";
  modal.classList.remove("hidden");

  try {
    let [drivers, trainings, packages] = await Promise.all([
      fetchDrivers(),
      fetchPersonnelTrainings().catch(() => []),
      fetchDriverPackages().catch(() => [])
    ]);
    let editingId = "";
    body.innerHTML = "";

    const form = document.createElement("div");
    form.className = "driver-management-form";
    const fields = {};
    [
      ["firstName", "Vorname", "text"],
      ["lastName", "Nachname", "text"],
      ["personnelNumber", "Personalnummer", "text"],
      ["depot", "Betriebshof", "text"],
      ["note", "Bemerkung", "textarea"]
    ].forEach(([key, labelText, type]) => {
      const label = document.createElement("label");
      const caption = document.createElement("span");
      caption.textContent = labelText;
      const input = type === "textarea" ? document.createElement("textarea") : document.createElement("input");
      if (type !== "textarea") input.type = type;
      label.append(caption, input);
      form.appendChild(label);
      fields[key] = input;
    });
    const rolesField = document.createElement("fieldset");
    rolesField.className = "driver-management-roles";
    const rolesLegend = document.createElement("legend");
    rolesLegend.textContent = "Rollen";
    const roleInputs = {};
    PERSON_ROLES.forEach(role => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = role;
      if (role === "Fahrer") checkbox.checked = true;
      roleInputs[role] = checkbox;
      label.append(checkbox, document.createTextNode(` ${role}`));
      rolesField.appendChild(label);
    });
    rolesField.prepend(rolesLegend);

    const activeLabel = document.createElement("label");
    activeLabel.className = "driver-management-active";
    const activeInput = document.createElement("input");
    activeInput.type = "checkbox";
    activeInput.checked = true;
    activeLabel.append(activeInput, document.createTextNode(" aktiv"));
    const formActions = document.createElement("div");
    formActions.className = "driver-documents-selection-actions";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "Person anlegen";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Bearbeitung abbrechen";
    cancelButton.hidden = true;
    formActions.append(saveButton, cancelButton);
    form.append(rolesField, activeLabel, formActions);

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "driver-management-search";
    searchInput.placeholder = "Personalnummer, Name, Betriebshof oder Rolle suchen";
    const filterBar = document.createElement("div");
    filterBar.className = "driver-management-filterbar";
    const sortNameBtn = document.createElement("button");
    sortNameBtn.type = "button";
    sortNameBtn.textContent = "Name A–Z";
    const sortNumberBtn = document.createElement("button");
    sortNumberBtn.type = "button";
    sortNumberBtn.textContent = "Personalnummer A–Z";
    const roleFilter = document.createElement("select");
    ["Alle", ...PERSON_ROLES].forEach(role => {
      const option = document.createElement("option");
      option.value = role === "Alle" ? "" : role;
      option.textContent = role === "Alle" ? "Rolle: Alle" : `Rolle: ${role}`;
      roleFilter.appendChild(option);
    });
    const depotFilter = document.createElement("select");
    const allDepotOption = document.createElement("option");
    allDepotOption.value = "";
    allDepotOption.textContent = "Betriebshof: Alle";
    depotFilter.appendChild(allDepotOption);
    Array.from(new Set(drivers.map(driver => String(driver.depot || "").trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "de-DE", { sensitivity: "base" }))
      .forEach(depot => {
        const option = document.createElement("option");
        option.value = depot;
        option.textContent = `Betriebshof: ${depot}`;
        depotFilter.appendChild(option);
      });
    const statusFilter = document.createElement("select");
    [
      ["", "Status: Alle"],
      ["active", "Status: Aktiv"],
      ["inactive", "Status: Inaktiv"]
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      statusFilter.appendChild(option);
    });
    filterBar.append(sortNameBtn, sortNumberBtn, roleFilter, depotFilter, statusFilter);
    const list = document.createElement("div");
    list.className = "driver-management-list";
    let sortKey = "name";
    let sortDirection = 1;

    const resetForm = () => {
      editingId = "";
      Object.values(fields).forEach(field => { field.value = ""; });
      Object.entries(roleInputs).forEach(([role, input]) => { input.checked = role === "Fahrer"; });
      activeInput.checked = true;
      saveButton.textContent = "Person anlegen";
      cancelButton.hidden = true;
    };

    const renderDrivers = () => {
      list.innerHTML = "";
      const query = searchInput.value.trim().toLocaleLowerCase("de-DE");
      drivers
        .filter(driver => [
          driver.firstName,
          driver.lastName,
          driver.personnelNumber,
          driver.depot,
          getPersonRoles(driver).join(" ")
        ].join(" ").toLocaleLowerCase("de-DE").includes(query))
        .filter(driver => !roleFilter.value || hasPersonRole(driver, roleFilter.value))
        .filter(driver => !depotFilter.value || String(driver.depot || "") === depotFilter.value)
        .filter(driver => {
          if (statusFilter.value === "active") return driver.active !== false;
          if (statusFilter.value === "inactive") return driver.active === false;
          return true;
        })
        .sort((left, right) => {
          const leftValue = sortKey === "personnelNumber"
            ? String(left.personnelNumber || "")
            : `${left.lastName || ""} ${left.firstName || ""}`;
          const rightValue = sortKey === "personnelNumber"
            ? String(right.personnelNumber || "")
            : `${right.lastName || ""} ${right.firstName || ""}`;
          return leftValue.localeCompare(rightValue, "de-DE", { numeric: true, sensitivity: "base" }) * sortDirection;
        })
        .forEach(driver => {
          const row = document.createElement("div");
          row.className = "driver-management-row";
          if (driver.active === false) row.classList.add("driver-management-inactive");
          const info = document.createElement("div");
          const name = document.createElement("strong");
          name.textContent = getDriverDisplayName(driver);
          const meta = document.createElement("small");
          meta.textContent = [
            driver.depot,
            driver.active === false ? "inaktiv" : "aktiv",
            driver.note
          ].filter(Boolean).join(" | ");
          const roles = document.createElement("div");
          roles.className = "driver-management-role-badges";
          getPersonRoles(driver).forEach(role => {
            const badge = document.createElement("span");
            badge.textContent = role;
            roles.appendChild(badge);
          });
          info.append(name, roles, meta);
          const actions = document.createElement("div");
          actions.className = "driver-documents-card-actions";
          const editButton = document.createElement("button");
          editButton.type = "button";
          editButton.textContent = "Bearbeiten";
          editButton.addEventListener("click", () => {
            editingId = driver.id;
            Object.keys(fields).forEach(key => { fields[key].value = driver[key] || ""; });
            const driverRoles = getPersonRoles(driver);
            Object.entries(roleInputs).forEach(([role, input]) => { input.checked = driverRoles.includes(role); });
            activeInput.checked = driver.active !== false;
            saveButton.textContent = "Änderungen speichern";
            cancelButton.hidden = false;
          });
          const detailButton = document.createElement("button");
          detailButton.type = "button";
          detailButton.textContent = "Kartei";
          detailButton.addEventListener("click", () => {
            renderPersonnelRecord(body, driver, trainings, packages);
          });
          const toggleButton = document.createElement("button");
          toggleButton.type = "button";
          toggleButton.textContent = driver.active === false ? "Aktivieren" : "Deaktivieren";
          toggleButton.addEventListener("click", async () => {
            await saveDriverAction({ action: "toggle", id: driver.id });
            drivers = await fetchDrivers();
            renderDrivers();
          });
          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.textContent = "Löschen";
          deleteButton.addEventListener("click", async () => {
            if (!confirm("Fahrer wirklich löschen?")) return;
            await saveDriverAction({ action: "delete", id: driver.id });
            drivers = await fetchDrivers();
            renderDrivers();
          });
          actions.append(detailButton, editButton, toggleButton, deleteButton);
          row.append(info, actions);
          list.appendChild(row);
        });
    };

    saveButton.addEventListener("click", async () => {
      await saveDriverAction({
        action: editingId ? "update" : "create",
        id: editingId,
        firstName: fields.firstName.value,
        lastName: fields.lastName.value,
        personnelNumber: fields.personnelNumber.value,
        depot: fields.depot.value,
        note: fields.note.value,
        roles: Object.values(roleInputs).filter(input => input.checked).map(input => input.value),
        active: activeInput.checked
      });
      drivers = await fetchDrivers();
      trainings = await fetchPersonnelTrainings().catch(() => []);
      packages = await fetchDriverPackages().catch(() => []);
      resetForm();
      renderDrivers();
    });
    cancelButton.addEventListener("click", resetForm);
    searchInput.addEventListener("input", renderDrivers);
    roleFilter.addEventListener("change", renderDrivers);
    depotFilter.addEventListener("change", renderDrivers);
    statusFilter.addEventListener("change", renderDrivers);
    sortNameBtn.addEventListener("click", () => {
      sortDirection = sortKey === "name" ? sortDirection * -1 : 1;
      sortKey = "name";
      sortNameBtn.textContent = sortDirection === 1 ? "Name A–Z" : "Name Z–A";
      renderDrivers();
    });
    sortNumberBtn.addEventListener("click", () => {
      sortDirection = sortKey === "personnelNumber" ? sortDirection * -1 : 1;
      sortKey = "personnelNumber";
      sortNumberBtn.textContent = sortDirection === 1 ? "Personalnummer A–Z" : "Personalnummer Z–A";
      renderDrivers();
    });
    renderDrivers();
    body.append(form, searchInput, filterBar, list);
  } catch (error) {
    body.textContent = error.message || "Personalverwaltung konnte nicht geladen werden.";
  }
}

async function fetchPersonnelTrainings() {
  if (typeof academyFetchTrainings === "function") return academyFetchTrainings();
  const response = await fetch("api/trainings.php", {
    cache: "no-store",
    headers: withApiAuthHeaders({})
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || "Einweisungen konnten nicht geladen werden.");
  }
  return Array.isArray(result.trainings) ? result.trainings : [];
}

function renderPersonnelRecord(container, person, trainings, packages) {
  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "driver-package-detail-header";
  const headingWrap = document.createElement("div");
  const eyebrow = document.createElement("small");
  eyebrow.textContent = "Personalverwaltung";
  const heading = document.createElement("h4");
  heading.textContent = getDriverDisplayName(person) || "Person";
  headingWrap.append(eyebrow, heading);
  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.textContent = "Zur Personalliste";
  backButton.addEventListener("click", openDriversDialog);
  header.append(headingWrap, backButton);

  const masterData = document.createElement("dl");
  masterData.className = "driver-documents-package-meta";
  [
    ["Personalnummer", person.personnelNumber || "-"],
    ["Vorname", person.firstName || "-"],
    ["Nachname", person.lastName || "-"],
    ["Rollen", getPersonRoles(person).join(", ")],
    ["Betriebshof", person.depot || "-"],
    ["Status", person.active === false ? "Inaktiv" : "Aktiv"],
    ["Bemerkung", person.note || "-"]
  ].forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    masterData.append(term, description);
  });

  const trainingTitle = document.createElement("h4");
  trainingTitle.textContent = "Einweisungen";
  const trainingList = document.createElement("div");
  trainingList.className = "driver-document-cards";
  getPersonnelTrainings(person, trainings).forEach(training => {
    const card = document.createElement("article");
    card.className = "driver-document-card";
    const info = document.createElement("dl");
    [
      ["Linie", academyRouteSummarySafe(training.routes || [])],
      ["Status", typeof academyStatusLabel === "function" ? academyStatusLabel(training.status) : (training.status || "-")],
      ["Erstellt", formatDriverPackageDate(training.created)],
      ["Abgeschlossen", training.completed ? formatDriverPackageDate(training.completed) : "-"]
    ].forEach(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value;
      info.append(term, description);
    });
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Einweisung öffnen";
    button.addEventListener("click", () => {
      if (typeof renderAcademyTrainingDetail === "function") renderAcademyTrainingDetail(container, training);
    });
    card.append(info, button);
    trainingList.appendChild(card);
  });
  if (!trainingList.children.length) {
    const empty = document.createElement("p");
    empty.textContent = "Keine Einweisungen vorhanden.";
    trainingList.appendChild(empty);
  }

  const documentTitle = document.createElement("h4");
  documentTitle.textContent = "Dokumente";
  const documentList = document.createElement("div");
  documentList.className = "driver-document-cards";
  getPersonnelPackages(person, packages).forEach(packageInfo => {
    const card = document.createElement("article");
    card.className = "driver-document-card";
    const info = document.createElement("dl");
    [
      ["Paket", packageInfo.driverName || getDriverFullName(person) || "Unbenannt"],
      ["Unterlagen", String(Number(packageInfo.documentCount || (packageInfo.documents || []).length || 0))],
      ["Erstellt", formatDriverPackageDate(packageInfo.created)]
    ].forEach(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value;
      info.append(term, description);
    });
    const actions = document.createElement("div");
    actions.className = "driver-documents-card-actions";
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.textContent = "Öffnen";
    openButton.addEventListener("click", () => renderDriverPackageDetail(container, packageInfo));
    const zipButton = document.createElement("button");
    zipButton.type = "button";
    zipButton.textContent = "Download";
    zipButton.addEventListener("click", () => downloadDriverPackageZip(packageInfo.id, zipButton));
    actions.append(openButton, zipButton);
    card.append(info, actions);
    documentList.appendChild(card);
  });
  if (!documentList.children.length) {
    const empty = document.createElement("p");
    empty.textContent = "Keine Lehrfahrer-Dokumente vorhanden.";
    documentList.appendChild(empty);
  }

  container.append(header, masterData, trainingTitle, trainingList, documentTitle, documentList);
}

function getPersonnelTrainings(person, trainings) {
  const personName = getDriverFullName(person).toLocaleLowerCase("de-DE");
  return (trainings || []).filter(training => {
    if (person.id && training.driverId === person.id) return true;
    return personName && String(training.driverName || "").trim().toLocaleLowerCase("de-DE") === personName;
  });
}

function getPersonnelPackages(person, packages) {
  const personName = getDriverFullName(person).toLocaleLowerCase("de-DE");
  return (packages || []).filter(packageInfo => {
    if (person.id && packageInfo.driverId === person.id) return true;
    return personName && String(packageInfo.driverName || "").trim().toLocaleLowerCase("de-DE") === personName;
  });
}

function academyRouteSummarySafe(routes) {
  if (typeof academyRouteSummary === "function") return academyRouteSummary(routes);
  const names = Array.from(new Set((routes || []).map(route => route.lineName).filter(Boolean)));
  return names.join(", ") || "-";
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
    const packages = (await fetchDriverPackages()).sort((a, b) =>
      String(b.created || "").localeCompare(String(a.created || ""))
    );
    if (!packages.length) {
      body.textContent = "Noch keine Einweisungspakete vorhanden.";
      return;
    }

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "driver-packages-search";
    searchInput.placeholder = "Fahrer, Linie, Richtung, Variante oder Kategorie suchen";
    const list = document.createElement("div");
    list.className = "driver-documents-packages";

    const renderPackages = () => {
      list.innerHTML = "";
      const query = searchInput.value.trim().toLocaleLowerCase("de-DE");
      packages
        .filter(packageInfo => getDriverPackageSearchText(packageInfo).includes(query))
        .forEach(packageInfo => list.appendChild(createDriverPackageCard(packageInfo, body)));
      if (!list.children.length) {
        const empty = document.createElement("p");
        empty.textContent = "Keine passenden Einweisungspakete gefunden.";
        list.appendChild(empty);
      }
    };
    searchInput.addEventListener("input", renderPackages);
    renderPackages();
    body.append(searchInput, list);
  } catch (error) {
    body.textContent = error.message || "Einweisungspakete konnten nicht geladen werden.";
  }
}

function getDriverPackageSearchText(packageInfo) {
  return [
    packageInfo.driverName,
    ...(packageInfo.documents || []).flatMap(documentInfo => [
      documentInfo.lineName,
      documentInfo.directionName,
      documentInfo.variantName,
      documentInfo.variantCategory
    ])
  ].filter(Boolean).join(" ").toLocaleLowerCase("de-DE");
}

function formatDriverPackageDate(value) {
  return value ? new Date(value).toLocaleString("de-DE") : "–";
}

function createDriverPackageCard(packageInfo, body) {
  const card = document.createElement("article");
  card.className = "driver-documents-package-card";
  const content = document.createElement("div");
  content.className = "driver-package-card-content";
  const title = document.createElement("h4");
  title.textContent = packageInfo.driverName || "Unbenannt";
  const facts = document.createElement("div");
  facts.className = "driver-package-card-facts";
  [
    ["Erstellt", formatDriverPackageDate(packageInfo.created)],
    ["Zuletzt geändert", formatDriverPackageDate(packageInfo.updated)],
    ["Unterlagen", String(Number(packageInfo.documentCount || 0))],
    ["Status", packageInfo.status || "Erstellt"]
  ].forEach(([label, value]) => {
    const fact = document.createElement("span");
    fact.textContent = `${label}: ${value}`;
    facts.appendChild(fact);
  });
  content.append(title, facts);
  if (packageInfo.note) {
    const note = document.createElement("p");
    note.className = "driver-package-note";
    note.textContent = packageInfo.note;
    content.appendChild(note);
  }
  const actions = createDriverPackageActions(packageInfo, body);
  card.append(content, actions);
  return card;
}

function createDriverPackageActions(packageInfo, body) {
  const actions = document.createElement("div");
  actions.className = "driver-documents-card-actions";
  const makeButton = (text, handler) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", handler);
    actions.appendChild(button);
    return button;
  };
  makeButton("Öffnen", () => renderDriverPackageDetail(body, packageInfo));
  const zipButton = makeButton("ZIP", () => downloadDriverPackageZip(packageInfo.id, zipButton));
  const pdfButton = makeButton("PDFs", () => renderDriverPackageDetail(body, packageInfo));
  pdfButton.disabled = !packageInfo.documents?.length;
  makeButton("Aktualisieren", () => openDriverDocumentsDialog({
    updatePackageId: packageInfo.id,
    driverName: packageInfo.driverName,
    note: packageInfo.note,
    selectedItems: packageInfo.selectedItems
  }));
  makeButton("Umbenennen", async () => {
    const newName = prompt("Neuer Fahrername:", packageInfo.driverName || "");
    if (newName === null) return;
    try {
      await manageDriverPackage("rename", packageInfo.id, { driverName: newName.trim() });
      openDriverPackagesDialog();
    } catch (error) {
      alert(error.message || "Paket konnte nicht umbenannt werden.");
    }
  });
  makeButton("Löschen", async () => {
    if (!confirm("Einweisungspaket wirklich löschen?")) return;
    try {
      await manageDriverPackage("delete", packageInfo.id);
      openDriverPackagesDialog();
    } catch (error) {
      alert(error.message || "Paket konnte nicht gelöscht werden.");
    }
  });
  return actions;
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
  renderDriverPackageDetail(container, result.package || {});
}

function formatDriverDocumentValidity(documentInfo) {
  const formatDate = value => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
  };
  const from = formatDate(documentInfo.validFrom);
  const until = formatDate(documentInfo.validUntil);
  if (from && until) return `${from} bis ${until}`;
  if (from) return `ab ${from}`;
  if (until) return `bis ${until}`;
  return "Immer gültig";
}

function renderDriverPackageDetail(container, packageData) {
  container.innerHTML = "";
  const detailHeader = document.createElement("div");
  detailHeader.className = "driver-package-detail-header";
  const headingWrap = document.createElement("div");
  const eyebrow = document.createElement("small");
  eyebrow.textContent = "Einweisungspaket";
  const heading = document.createElement("h4");
  heading.textContent = packageData.driverName || "Unbenannt";
  headingWrap.append(eyebrow, heading);
  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.textContent = "Zur Übersicht";
  backButton.addEventListener("click", openDriverPackagesDialog);
  detailHeader.append(headingWrap, backButton);

  const meta = document.createElement("dl");
  meta.className = "driver-documents-package-meta";
  const createdAt = packageData.created || packageData.createdAt
    ? new Date(packageData.created || packageData.createdAt).toLocaleString("de-DE")
    : "";
  const updatedAt = packageData.updated
    ? new Date(packageData.updated).toLocaleString("de-DE")
    : createdAt;
  [
    ["Fahrer", packageData.driverName || "Unbenannt"],
    ["Erstellt", createdAt],
    ["Zuletzt geändert", updatedAt],
    ["Status", packageData.status || "Erstellt"]
  ].forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    meta.append(term, description);
  });

  const documents = packageData.documents || [];
  const lineCount = packageData.lineCount ?? new Set(documents.map(item => item.lineName).filter(Boolean)).size;
  const categories = packageData.categories?.length
    ? packageData.categories
    : Array.from(new Set(documents.map(item => item.variantCategory).filter(Boolean)));
  const validityLabels = Array.from(new Set(documents.map(formatDriverDocumentValidity)));
  const packageInfo = document.createElement("div");
  packageInfo.className = "driver-package-information";
  [
    ["Unterlagen", String(Number(packageData.documentCount ?? documents.length))],
    ["Linien", String(Number(lineCount || 0))],
    ["Kategorien", categories.join(", ") || "–"],
    ["Gültigkeit", validityLabels.join(", ") || "Immer gültig"],
    ["Version", String(packageData.version || 1)]
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    const caption = document.createElement("span");
    caption.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value;
    item.append(caption, content);
    packageInfo.appendChild(item);
  });

  const sectionTitle = document.createElement("h4");
  sectionTitle.textContent = "Alle Unterlagen";
  const list = document.createElement("div");
  list.className = "driver-document-cards";
  documents.forEach(documentInfo => {
    const item = document.createElement("article");
    item.className = "driver-document-card";
    const info = document.createElement("dl");
    [
      ["Linie", documentInfo.lineName || "–"],
      ["Route", documentInfo.routeName || "–"],
      ["Richtung", documentInfo.directionName || "–"],
      ["Variante", documentInfo.variantName || "–"],
      ["Kategorie", documentInfo.variantCategory || "Standard"]
    ].forEach(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value;
      info.append(term, description);
    });
    const link = document.createElement("a");
    link.href = documentInfo.path;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "driver-documents-open";
    link.textContent = "PDF öffnen";
    item.append(info, link);
    list.appendChild(item);
  });

  const savedHint = document.createElement("small");
  savedHint.className = "driver-documents-saved-hint";
  savedHint.textContent = "Paketdaten gespeichert";
  container.append(detailHeader, meta, packageInfo, sectionTitle, list, savedHint);
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
