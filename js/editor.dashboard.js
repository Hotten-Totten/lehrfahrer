// Start-Dashboard fuer Disposition und Einweisungsueberblick.
function getDashboardModal() {
  let modal = document.getElementById("dashboardModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "dashboardModal";
    modal.className = "help-modal hidden";
    modal.innerHTML = `
      <div class="help-modal-content dashboard-modal-content">
        <div class="help-modal-header">
          <h3>Dashboard</h3>
          <button type="button" class="dashboard-close" aria-label="Schließen">Schließen</button>
        </div>
        <div class="dashboard-body"></div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector(".dashboard-close").addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", event => {
      if (event.target === modal) modal.classList.add("hidden");
    });
  }
  return modal;
}

async function openDashboard() {
  const modal = getDashboardModal();
  const body = modal.querySelector(".dashboard-body");
  body.textContent = "Dashboard wird geladen ...";
  modal.classList.remove("hidden");

  const [driversResult, trainingsResult, completedResult, packagesResult, linesResult] = await Promise.allSettled([
    fetchDrivers(),
    academyFetchTrainings("running"),
    academyFetchTrainings("completed"),
    fetchDriverPackages(),
    fetch(`${API_LIST_LINES_URL}?_ts=${Date.now()}`, { cache: "no-store" }).then(response => response.json())
  ]);

  const drivers = driversResult.status === "fulfilled" ? driversResult.value : [];
  const trainings = trainingsResult.status === "fulfilled" ? trainingsResult.value : [];
  const completed = completedResult.status === "fulfilled" ? completedResult.value : [];
  const packages = packagesResult.status === "fulfilled" ? packagesResult.value : [];
  const linesPayload = linesResult.status === "fulfilled" ? linesResult.value : {};
  const lines = Array.isArray(linesPayload.lines) ? linesPayload.lines : [];

  renderDashboard(body, { drivers, trainings, completed, packages, lines });
}

function renderDashboard(container, data) {
  container.innerHTML = "";
  const activePersons = data.drivers.filter(person => person.active !== false).length;
  const documentCount = data.packages.reduce((sum, item) => (
    sum + Number(item.documentCount || (item.documents || []).length || 0)
  ), 0);
  const lineCount = data.lines.length;

  const hero = document.createElement("section");
  hero.className = "dashboard-hero";
  const title = document.createElement("div");
  const brand = document.createElement("h2");
  brand.textContent = "Lehrfahrer®";
  const claim = document.createElement("p");
  claim.textContent = "Erfahrung fährt mit.";
  title.append(brand, claim);
  const date = document.createElement("time");
  date.textContent = new Date().toLocaleDateString("de-DE", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  hero.append(title, date);

  const stats = document.createElement("section");
  stats.className = "dashboard-stats";
  [
    ["👤", "Personal", activePersons],
    ["🎓", "Laufende Einweisungen", data.trainings.length],
    ["📄", "Dokumente", documentCount],
    ["🚋", "Linien", lineCount]
  ].forEach(([icon, label, value]) => {
    const card = document.createElement("article");
    card.className = "dashboard-stat";
    const iconNode = document.createElement("span");
    iconNode.textContent = icon;
    const valueNode = document.createElement("strong");
    valueNode.textContent = String(value);
    const labelNode = document.createElement("small");
    labelNode.textContent = label;
    card.append(iconNode, valueNode, labelNode);
    stats.appendChild(card);
  });

  const grid = document.createElement("section");
  grid.className = "dashboard-grid";
  grid.append(
    createDashboardTrainingList("Heute", data.trainings.slice(0, 8), "Keine laufenden Einweisungen."),
    createDashboardTrainingList("Zuletzt abgeschlossen", data.completed.slice(0, 6), "Noch keine abgeschlossenen Einweisungen.")
  );

  const actions = document.createElement("section");
  actions.className = "dashboard-actions";
  const actionsTitle = document.createElement("h4");
  actionsTitle.textContent = "Schnellaktionen";
  const actionRow = document.createElement("div");
  [
    ["Neue Einweisung", () => { getDashboardModal().classList.add("hidden"); openAcademyNewTrainingDialog(); }],
    ["Neue Person", () => { getDashboardModal().classList.add("hidden"); openDriversDialog(); }],
    ["Linie bearbeiten", () => { getDashboardModal().classList.add("hidden"); document.getElementById("loadLineBtn")?.click(); }],
    ["Fahrerunterlagen erstellen", () => { getDashboardModal().classList.add("hidden"); openDriverDocumentsDialog(); }]
  ].forEach(([label, handler]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", handler);
    actionRow.appendChild(button);
  });
  actions.append(actionsTitle, actionRow);

  container.append(hero, stats, grid, actions);
}

function createDashboardTrainingList(titleText, trainings, emptyText) {
  const section = document.createElement("article");
  section.className = "dashboard-panel";
  const title = document.createElement("h4");
  title.textContent = titleText;
  const list = document.createElement("div");
  list.className = "dashboard-training-list";
  if (!trainings.length) {
    const empty = document.createElement("p");
    empty.textContent = emptyText;
    list.appendChild(empty);
  } else {
    trainings.forEach(training => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "dashboard-training-item";
      const name = document.createElement("strong");
      name.textContent = training.driverName || "Unbenannte Einweisung";
      const meta = document.createElement("span");
      meta.textContent = [
        academyRouteSummary(training.routes || []),
        academyStatusLabel(training.status),
        formatDriverPackageDate(training.created)
      ].filter(Boolean).join(" | ");
      item.append(name, meta);
      item.addEventListener("click", () => {
        getDashboardModal().classList.add("hidden");
        const modal = getAcademyModal("Einweisung");
        const body = modal.querySelector(".driver-documents-body");
        modal.classList.remove("hidden");
        renderAcademyTrainingDetail(body, training);
      });
      list.appendChild(item);
    });
  }
  section.append(title, list);
  return section;
}

window.addEventListener("load", () => {
  setTimeout(openDashboard, 250);
});
