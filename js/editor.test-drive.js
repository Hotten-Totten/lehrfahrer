// Rein visuelle Testfahrt auf einer Kopie der vorhandenen Editor-Geometrie.
(function (global) {
  "use strict";

  const BASE_METERS_PER_SECOND = 50;
  const BUS_SVG = '<svg class="test-drive-bus-rotor" viewBox="0 0 32 48" width="32" height="48" aria-hidden="true">' +
    '<rect x="4" y="7" width="24" height="37" rx="6" fill="#174a88" stroke="#fff" stroke-width="2"/>' +
    '<rect x="8" y="10" width="16" height="8" rx="2" fill="#b9def4"/>' +
    '<rect x="8" y="23" width="16" height="13" rx="2" fill="#d8e8ef"/>' +
    '<rect x="1" y="15" width="3" height="8" rx="1" fill="#25364a"/>' +
    '<rect x="28" y="15" width="3" height="8" rx="1" fill="#25364a"/>' +
    '<path d="M16 1 L21 7 H11 Z" fill="#174a88" stroke="#fff" stroke-width="1.5"/>' +
    '</svg>';
  let drive = null;

  function copyGeometry(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const copied = points.map(point => ({ lat: point?.lat, lon: point?.lon }));
    if (copied.some(point => !Number.isFinite(point.lat) || !Number.isFinite(point.lon) ||
        Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180)) return null;
    const distances = [0];
    for (let i = 1; i < copied.length; i++) {
      distances.push(distances[i - 1] + distanceMetersBetween(copied[i - 1], copied[i]));
    }
    const total = distances[distances.length - 1];
    return Number.isFinite(total) && total > 0 ? { points: copied, distances, total } : null;
  }

  function positionAt(geometry, meters) {
    const distance = Math.max(0, Math.min(geometry.total, meters));
    let low = 1, high = geometry.distances.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (geometry.distances[mid] <= distance) low = mid + 1;
      else high = mid;
    }
    let end = distance >= geometry.total ? geometry.points.length - 1 : low;
    while (end > 1 && geometry.distances[end] === geometry.distances[end - 1]) end--;
    const start = end - 1;
    const from = geometry.points[start], to = geometry.points[end];
    const length = geometry.distances[end] - geometry.distances[start];
    const fraction = length > 0
      ? Math.max(0, Math.min(1, (distance - geometry.distances[start]) / length)) : 1;
    const dx = (to.lon - from.lon) * Math.cos((from.lat + to.lat) * Math.PI / 360);
    return {
      lat: from.lat + (to.lat - from.lat) * fraction,
      lon: from.lon + (to.lon - from.lon) * fraction,
      bearing: length > 0 ? Math.atan2(dx, to.lat - from.lat) * 180 / Math.PI : null
    };
  }

  function makeMarker(point) {
    const adapter = global.EditorMapAdapter;
    const map = adapter?.getActiveMap?.();
    if (!map) return null;
    if (adapter.getActiveMapEngine() === "maplibre") {
      if (!global.maplibregl?.Marker) return null;
      const element = document.createElement("div");
      element.className = "test-drive-bus-marker";
      element.innerHTML = BUS_SVG;
      const marker = new global.maplibregl.Marker({ element, anchor: "center" })
        .setLngLat([point.lon, point.lat]).addTo(map);
      element.style.pointerEvents = "none";
      return {
        setPosition(p) { marker.setLngLat([p.lon, p.lat]); },
        setBearing(b) { element.querySelector("svg").style.transform = "rotate(" + b + "deg)"; },
        remove() { marker.remove(); }
      };
    }
    if (!global.L?.marker || !global.L?.divIcon) return null;
    const marker = global.L.marker([point.lat, point.lon], {
      icon: global.L.divIcon({
        html: BUS_SVG, className: "test-drive-leaflet-icon",
        iconSize: [32, 48], iconAnchor: [16, 24]
      }),
      interactive: false, keyboard: false
    }).addTo(map);
    return {
      setPosition(p) { marker.setLatLng([p.lat, p.lon]); },
      setBearing(b) {
        const svg = marker.getElement()?.querySelector("svg");
        if (svg) svg.style.transform = "rotate(" + b + "deg)";
      },
      remove() { marker.remove(); }
    };
  }

  function controls() { return document.getElementById("testDriveControls"); }

  function updateControls() {
    const bar = controls();
    if (!bar) return;
    bar.hidden = !drive;
    if (!drive) return;
    const pause = document.getElementById("testDrivePauseBtn");
    pause.textContent = drive.finished ? "Am Ziel" : drive.paused ? "Weiter" : "Pause";
    pause.disabled = drive.finished;
    bar.querySelectorAll("[data-test-drive-speed]").forEach(button => {
      button.classList.toggle("active", Number(button.dataset.testDriveSpeed) === drive.speed);
    });
    const follow = document.getElementById("testDriveFollowBtn");
    follow.setAttribute("aria-pressed", String(drive.follow));
    follow.classList.toggle("active", drive.follow);
  }

  function maybeFollow(point) {
    if (!drive?.follow) return;
    const adapter = global.EditorMapAdapter;
    const pixel = adapter?.projectEditorCoordinate?.(point);
    const container = adapter?.getActiveMap?.()?.getContainer?.();
    if (!pixel || !container) return;
    const marginX = container.clientWidth * 0.2, marginY = container.clientHeight * 0.2;
    const x = Math.max(marginX, Math.min(container.clientWidth - marginX, pixel.x));
    const y = Math.max(marginY, Math.min(container.clientHeight - marginY, pixel.y));
    if ((Math.abs(pixel.x - x) > 1 || Math.abs(pixel.y - y) > 1) &&
        Date.now() - drive.lastFollowAt > 1500) {
      drive.lastFollowAt = Date.now();
      if (adapter.getActiveMapEngine() === "maplibre") {
        adapter.getActiveMap().panTo([point.lon, point.lat], { duration: 450 });
      } else {
        adapter.getActiveMap().panTo([point.lat, point.lon], { animate: true, duration: 0.45 });
      }
    }
  }

  function render() {
    if (!drive) return;
    const point = positionAt(drive.geometry, drive.meters);
    drive.marker.setPosition(point);
    if (point.bearing != null) drive.marker.setBearing(point.bearing);
    maybeFollow(point);
  }

  function tick(timestamp) {
    if (!drive || drive.paused || drive.finished) return;
    if (drive.lastTimestamp != null) {
      drive.meters = Math.min(drive.geometry.total,
        drive.meters + Math.max(0, timestamp - drive.lastTimestamp) *
          BASE_METERS_PER_SECOND * drive.speed / 1000);
    }
    drive.lastTimestamp = timestamp;
    render();
    if (drive.meters >= drive.geometry.total) {
      drive.finished = true;
      drive.frame = null;
      updateControls();
    } else {
      drive.frame = global.requestAnimationFrame(tick);
    }
  }

  function stop() {
    if (!drive) return;
    if (drive.frame != null) global.cancelAnimationFrame(drive.frame);
    drive.map?.off?.("dragstart", drive.onManualPan);
    drive.marker.remove();
    drive = null;
    updateControls();
  }

  function start() {
    stop();
    const geometry = copyGeometry(state.routePoints);
    if (!geometry) {
      showInfoPopup({ title: "Testfahrt",
        message: "Für eine Testfahrt muss zuerst eine Route erzeugt werden.", level: "warning" });
      return false;
    }
    const marker = makeMarker(positionAt(geometry, 0));
    if (!marker) {
      showInfoPopup({ title: "Testfahrt",
        message: "Die Karte ist für die Testfahrt noch nicht bereit.", level: "warning" });
      return false;
    }
    const map = global.EditorMapAdapter.getActiveMap();
    const onManualPan = () => {
      if (drive) { drive.follow = false; updateControls(); }
    };
    map?.on?.("dragstart", onManualPan);
    drive = { geometry, marker, map, onManualPan, meters: 0, speed: 1, paused: false,
      finished: false, follow: true, frame: null, lastTimestamp: null, lastFollowAt: 0 };
    render();
    updateControls();
    setStatus("Testfahrt läuft auf der ursprünglichen Routengeometrie.");
    drive.frame = global.requestAnimationFrame(tick);
    return true;
  }

  function togglePause() {
    if (!drive || drive.finished) return;
    if (!drive.paused) {
      if (drive.frame != null) global.cancelAnimationFrame(drive.frame);
      drive.frame = null;
      drive.paused = true;
    } else {
      drive.paused = false;
      drive.lastTimestamp = null;
      drive.frame = global.requestAnimationFrame(tick);
    }
    updateControls();
  }

  function setSpeed(value) {
    if (!drive || ![0.5, 1, 2].includes(value)) return;
    drive.speed = value;
    drive.lastTimestamp = null;
    updateControls();
  }

  function onRouteRender() {
    if (!drive) return;
    const original = state.routePoints, snapshot = drive.geometry.points;
    if (!Array.isArray(original) || original.length !== snapshot.length ||
        original.some((point, i) => point.lat !== snapshot[i].lat ||
          point.lon !== snapshot[i].lon)) stop();
  }

  function bind() {
    document.getElementById("startTestDriveBtn")?.addEventListener("click", start);
    document.getElementById("testDriveStopBtn")?.addEventListener("click", stop);
    document.getElementById("testDrivePauseBtn")?.addEventListener("click", togglePause);
    document.getElementById("testDriveFollowBtn")?.addEventListener("click", () => {
      if (!drive) return;
      drive.follow = !drive.follow;
      updateControls();
    });
    controls()?.querySelectorAll("[data-test-drive-speed]").forEach(button => {
      button.addEventListener("click", () => setSpeed(Number(button.dataset.testDriveSpeed)));
    });
    [
      "quickNewBtn", "loadLineBtn", "clearBtn", "buildStreetRouteBtn",
      "rerouteSegmentBtn", "finishSpecialTrackBtn", "finishDetourDraftBtn",
      "smoothRouteBtn", "undoBtn", "redoBtn", "loadAutosaveBtn"
    ].forEach(id => document.getElementById(id)?.addEventListener("click", stop, true));
    global.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && drive && !drive.paused && !drive.finished) togglePause();
    });
    updateControls();
  }

  global.EditorTestDrive = Object.freeze({
    start, stop, togglePause, setSpeed, onRouteRender, copyGeometry, positionAt,
    getState: () => drive && { meters: drive.meters, speed: drive.speed,
      paused: drive.paused, finished: drive.finished, follow: drive.follow }
  });
  if (global.document) bind();
})(window);
