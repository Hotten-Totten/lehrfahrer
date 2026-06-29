// Grundmodul fuer digitale Streckeneinweisungen.
async function academyFetchTrainings(status = "") {
  const url = `api/trainings.php${status ? `?status=${encodeURIComponent(status)}` : ""}`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: withApiAuthHeaders({})
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || "Einweisungen konnten nicht geladen werden.");
  }
  return Array.isArray(result.trainings) ? result.trainings : [];
}

async function academyCreateTraining(payload) {
  const response = await fetch("api/trainings.php", {
    method: "POST",
    headers: withApiAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action: "create", ...payload })
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || "Einweisung konnte nicht erstellt werden.");
  }
  return result.training || {};
}

async function academyUpdateTrainingStatus(trainingId, status) {
  const response = await fetch("api/trainings.php", {
    method: "POST",
    headers: withApiAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action: "updateStatus", trainingId, status })
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || "Einweisungsstatus konnte nicht aktualisiert werden.");
  }
  return result.training || {};
}

async function academyCompleteTrainingRoute(trainingId, routeIndex) {
  const response = await fetch("api/trainings.php", {
    method: "POST",
    headers: withApiAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action: "completeRoute", trainingId, routeIndex })
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || "Linie konnte nicht abgeschlossen werden.");
  }
  return result.training || {};
}

function getAcademyModal(title) {
  const modal = getDriverDocumentsModal(title);
  modal.querySelector(".help-modal-content").classList.add("academy-modal-content");
  return modal;
}

async function openAcademyNewTrainingDialog() {
  const modal = getAcademyModal("Neue Einweisung");
  const body = modal.querySelector(".driver-documents-body");
  body.textContent = "Daten werden geladen ...";
  modal.classList.remove("hidden");

  try {
    const [drivers, linesResponse] = await Promise.all([
      fetchDrivers().catch(() => []),
      fetch(`${API_LIST_LINES_URL}?_ts=${Date.now()}`, { cache: "no-store" })
    ]);
    const linesResult = await linesResponse.json();
    if (!linesResponse.ok || !linesResult?.ok || !Array.isArray(linesResult.lines)) {
      throw new Error(linesResult?.error || "Linien konnten nicht geladen werden.");
    }

    body.innerHTML = "";

    const form = document.createElement("div");
    form.className = "academy-form";

    const driverSelectLabel = document.createElement("label");
    driverSelectLabel.innerHTML = "<span>Fahrer auswählen</span>";
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
    driverSelectLabel.appendChild(driverSelect);

    const driverNameLabel = document.createElement("label");
    driverNameLabel.innerHTML = "<span>Name Fahrer/in</span>";
    const driverNameInput = document.createElement("input");
    driverNameInput.type = "text";
    driverNameInput.placeholder = "optional";
    driverNameLabel.appendChild(driverNameInput);

    driverSelect.addEventListener("change", () => {
      const option = driverSelect.selectedOptions[0];
      if (option?.value) driverNameInput.value = option.dataset.driverName || option.textContent || "";
    });

    const trainerLabel = document.createElement("label");
    trainerLabel.innerHTML = "<span>Einweiser auswählen</span>";
    const trainerSelect = document.createElement("select");
    const trainerFallbackOption = document.createElement("option");
    trainerFallbackOption.value = "";
    trainerFallbackOption.textContent = "Freitext / nicht in Personalkartei";
    trainerSelect.appendChild(trainerFallbackOption);
    drivers.filter(driver => driver.active !== false && hasPersonRole(driver, "Einweiser")).forEach(driver => {
      const option = document.createElement("option");
      option.value = driver.id;
      option.textContent = getDriverDisplayName(driver);
      option.dataset.trainerName = getDriverFullName(driver);
      trainerSelect.appendChild(option);
    });
    trainerLabel.appendChild(trainerSelect);

    const trainerTextLabel = document.createElement("label");
    trainerTextLabel.innerHTML = "<span>Einweiser Freitext</span>";
    const trainerInput = document.createElement("input");
    trainerInput.type = "text";
    trainerInput.placeholder = "optional";
    trainerTextLabel.appendChild(trainerInput);
    trainerSelect.addEventListener("change", () => {
      const option = trainerSelect.selectedOptions[0];
      if (option?.value) trainerInput.value = option.dataset.trainerName || option.textContent || "";
    });

    const notesLabel = document.createElement("label");
    notesLabel.className = "academy-notes-field";
    notesLabel.innerHTML = "<span>Bemerkung</span>";
    const notesInput = document.createElement("textarea");
    notesInput.placeholder = "Besonderheiten dieser Einweisung";
    notesLabel.appendChild(notesInput);

    form.append(driverSelectLabel, driverNameLabel, trainerLabel, trainerTextLabel, notesLabel);

    const routeTools = document.createElement("div");
    routeTools.className = "driver-documents-selection-actions";
    const selectAllBtn = document.createElement("button");
    selectAllBtn.type = "button";
    selectAllBtn.textContent = "Alle auswählen";
    const selectNoneBtn = document.createElement("button");
    selectNoneBtn.type = "button";
    selectNoneBtn.textContent = "Keine auswählen";
    routeTools.append(selectAllBtn, selectNoneBtn);

    const routeList = document.createElement("div");
    routeList.className = "academy-route-list";
    const entries = linesResult.lines.map(line => {
      const row = document.createElement("label");
      row.className = "academy-route-entry";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      const text = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = [
        line.lineName,
        line.variantName || line.routeName
      ].filter(Boolean).join(" - ");
      const meta = document.createElement("small");
      meta.textContent = [
        line.city,
        line.routeName,
        line.directionName,
        line.variantCategory || "Standard"
      ].filter(Boolean).join(" | ");
      text.append(title, meta);
      row.append(checkbox, text);
      routeList.appendChild(row);
      return { line, checkbox };
    });

    selectAllBtn.addEventListener("click", () => entries.forEach(entry => { entry.checkbox.checked = true; }));
    selectNoneBtn.addEventListener("click", () => entries.forEach(entry => { entry.checkbox.checked = false; }));

    const footer = document.createElement("div");
    footer.className = "driver-documents-footer";
    const status = document.createElement("span");
    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "driver-documents-create";
    createBtn.textContent = "Einweisung erstellen";
    footer.append(status, createBtn);

    createBtn.addEventListener("click", async () => {
      const selected = entries.filter(entry => entry.checkbox.checked);
      if (!selected.length) {
        status.textContent = "Bitte mindestens eine Linie auswählen.";
        return;
      }
      createBtn.disabled = true;
      status.textContent = "Einweisung wird erstellt ...";
      try {
        const training = await academyCreateTraining({
          status: "created",
          driverId: driverSelect.value || "",
          driverName: driverNameInput.value.trim(),
          trainer: trainerInput.value.trim(),
          company: "",
          routes: selected.map(entry => ({
            city: entry.line.city,
            lineFolder: entry.line.lineFolder,
            categoryFolder: entry.line.categoryFolder,
            fileBase: entry.line.fileBase,
            lineName: entry.line.lineName,
            routeName: entry.line.routeName,
            directionName: entry.line.directionName,
            variantName: entry.line.variantName,
            variantCategory: entry.line.variantCategory,
            jsonPath: entry.line.jsonPath,
            pdfPath: entry.line.pdfPath,
            gpxPath: entry.line.gpxPath
          })),
          documents: [],
          notes: notesInput.value.trim()
        });
        renderAcademyTrainingDetail(body, training);
      } catch (error) {
        status.textContent = error.message || "Einweisung konnte nicht erstellt werden.";
        createBtn.disabled = false;
      }
    });

    body.append(form, routeTools, routeList, footer);
  } catch (error) {
    body.textContent = error.message || "Neue Einweisung konnte nicht vorbereitet werden.";
  }
}

async function openAcademyTrainingsDialog(status = "running") {
  const title = status === "completed" ? "Abgeschlossene Einweisungen" : "Laufende Einweisungen";
  const modal = getAcademyModal(title);
  const body = modal.querySelector(".driver-documents-body");
  body.textContent = "Einweisungen werden geladen ...";
  modal.classList.remove("hidden");

  try {
    const trainings = await academyFetchTrainings(status);
    body.innerHTML = "";
    if (!trainings.length) {
      body.textContent = status === "completed"
        ? "Noch keine abgeschlossenen Einweisungen vorhanden."
        : "Noch keine laufenden Einweisungen vorhanden.";
      return;
    }

    const list = document.createElement("div");
    list.className = "academy-training-cards";
    trainings.forEach(training => list.appendChild(createAcademyTrainingCard(training, body)));
    body.appendChild(list);
  } catch (error) {
    body.textContent = error.message || "Einweisungen konnten nicht geladen werden.";
  }
}

function createAcademyTrainingCard(training, body) {
  const card = document.createElement("article");
  card.className = "academy-training-card";
  const title = document.createElement("h4");
  title.textContent = training.driverName || "Unbenannte Einweisung";
  const facts = document.createElement("div");
  facts.className = "academy-training-facts";
  [
    ["Einweiser", training.trainer || "-"],
    ["Status", academyStatusLabel(training.status)],
    ["Linien", academyRouteSummary(training.routes || [])],
    ["Erstellt", formatDriverPackageDate(training.created)]
  ].forEach(([label, value]) => {
    const item = document.createElement("span");
    item.textContent = `${label}: ${value}`;
    facts.appendChild(item);
  });
  if (training.status === "completed" && training.completed) {
    const completed = document.createElement("span");
    completed.textContent = `Abgeschlossen: ${formatDriverPackageDate(training.completed)}`;
    facts.appendChild(completed);
  }
  if (training.notes) {
    const note = document.createElement("p");
    note.className = "academy-training-note";
    note.textContent = training.notes;
    card.append(title, facts, note);
  } else {
    card.append(title, facts);
  }
  const actions = document.createElement("div");
  actions.className = "driver-documents-card-actions";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.textContent = "Öffnen";
  openBtn.addEventListener("click", () => renderAcademyTrainingDetail(body, training));
  actions.appendChild(openBtn);
  appendAcademyStatusActions(actions, training, {
    onUpdated: updated => {
      if (updated.status === "completed") openAcademyTrainingsDialog("completed");
      else openAcademyTrainingsDialog("running");
    }
  });
  card.appendChild(actions);
  return card;
}

function renderAcademyTrainingDetail(container, training) {
  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "driver-package-detail-header";
  const headingWrap = document.createElement("div");
  const eyebrow = document.createElement("small");
  eyebrow.textContent = training.trainingId || "Einweisung";
  const heading = document.createElement("h4");
  heading.textContent = training.driverName || "Unbenannte Einweisung";
  headingWrap.append(eyebrow, heading);
  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.textContent = training.status === "completed" ? "Zu abgeschlossenen Einweisungen" : "Zu laufenden Einweisungen";
  backButton.addEventListener("click", () => openAcademyTrainingsDialog(
    training.status === "completed" ? "completed" : "running"
  ));
  header.append(headingWrap, backButton);

  const meta = document.createElement("dl");
  meta.className = "driver-documents-package-meta";
  [
    ["Status", academyStatusLabel(training.status)],
    ["Einweiser", training.trainer || "-"],
    ["Erstellt", formatDriverPackageDate(training.created)],
    ["Zuletzt geändert", formatDriverPackageDate(training.updated)],
    ["Abgeschlossen", training.completed ? formatDriverPackageDate(training.completed) : "-"]
  ].forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    meta.append(term, description);
  });

  const routesTitle = document.createElement("h4");
  routesTitle.textContent = "Linien";
  const routes = document.createElement("div");
  routes.className = "driver-document-cards";
  const normalizedRoutes = normalizeAcademyRoutes(training.routes || []);
  normalizedRoutes.forEach((route, routeIndex) => {
    const item = document.createElement("article");
    item.className = "driver-document-card";
    const info = document.createElement("dl");
    [
      ["Linie", route.lineName || "-"],
      ["Route", route.routeName || "-"],
      ["Richtung", route.directionName || "-"],
      ["Variante", route.variantName || "-"],
      ["Kategorie", route.variantCategory || "Standard"],
      ["Status", route.routeStatus === "completed" ? `abgeschlossen am ${formatDriverPackageDate(route.completedAt)}` : "offen"]
    ].forEach(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value;
      info.append(term, description);
    });
    item.appendChild(info);
    if (["created", "running"].includes(training.status) && route.routeStatus !== "completed") {
      const completeRouteBtn = document.createElement("button");
      completeRouteBtn.type = "button";
      completeRouteBtn.textContent = "Linie abschließen";
      completeRouteBtn.addEventListener("click", async () => {
        if (!confirm("Diese Linie wirklich als abgeschlossen markieren?")) return;
        completeRouteBtn.disabled = true;
        try {
          const updated = await academyCompleteTrainingRoute(training.trainingId, routeIndex);
          renderAcademyTrainingDetail(container, updated);
        } catch (error) {
          alert(error.message || "Linie konnte nicht abgeschlossen werden.");
          completeRouteBtn.disabled = false;
        }
      });
      item.appendChild(completeRouteBtn);
    }
    routes.appendChild(item);
  });
  const allRoutesCompleted = normalizedRoutes.length > 0
    && normalizedRoutes.every(route => route.routeStatus === "completed");
  const routeHint = document.createElement("p");
  routeHint.className = "academy-training-note";
  routeHint.textContent = allRoutesCompleted && ["created", "running"].includes(training.status)
    ? "Alle Linien abgeschlossen – Einweisung kann abgeschlossen werden."
    : "";

  const statusActions = document.createElement("div");
  statusActions.className = "driver-documents-card-actions";
  appendAcademyStatusActions(statusActions, training, {
    onUpdated: updated => {
      if (updated.status === "archived") openAcademyTrainingsDialog("completed");
      else renderAcademyTrainingDetail(container, updated);
    }
  });

  if (training.notes) {
    const notes = document.createElement("p");
    notes.className = "academy-training-note";
    notes.textContent = training.notes;
    container.append(header, meta, statusActions, notes, routesTitle, routes);
  } else {
    container.append(header, meta, statusActions, routesTitle, routes);
  }
  if (routeHint.textContent) container.appendChild(routeHint);
}

function appendAcademyStatusActions(container, training, options = {}) {
  academyAvailableStatusActions(training.status).forEach(action => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", async () => {
      if (action.confirm && !confirm(action.confirm)) return;
      button.disabled = true;
      try {
        const updated = await academyUpdateTrainingStatus(training.trainingId, action.status);
        if (typeof options.onUpdated === "function") options.onUpdated(updated);
      } catch (error) {
        alert(error.message || "Status konnte nicht aktualisiert werden.");
        button.disabled = false;
      }
    });
    container.appendChild(button);
  });
}

function academyAvailableStatusActions(status) {
  if (status === "created") {
    return [
      { status: "running", label: "Als laufend markieren" },
      { status: "completed", label: "Abschließen", confirm: "Einweisung wirklich abschließen?" }
    ];
  }
  if (status === "running") {
    return [
      { status: "completed", label: "Abschließen", confirm: "Einweisung wirklich abschließen?" }
    ];
  }
  if (status === "completed") {
    return [
      { status: "archived", label: "Archivieren", confirm: "Einweisung wirklich archivieren?" }
    ];
  }
  return [];
}

function academyStatusLabel(status) {
  const labels = {
    created: "Erstellt",
    running: "Laufend",
    completed: "Abgeschlossen",
    archived: "Archiviert"
  };
  return labels[status] || "Erstellt";
}

function academyRouteSummary(routes) {
  const names = Array.from(new Set((routes || []).map(route => route.lineName).filter(Boolean)));
  return names.join(", ") || "-";
}

function normalizeAcademyRoutes(routes) {
  return (routes || []).map(route => ({
    ...route,
    routeStatus: route.routeStatus === "completed" ? "completed" : "open",
    completedAt: route.completedAt || ""
  }));
}
