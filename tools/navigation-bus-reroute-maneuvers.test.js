const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'app/js/app.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(projectRoot, 'app/index.html'), 'utf8');
const appCss = fs.readFileSync(path.join(projectRoot, 'app/css/app.css'), 'utf8');
const routerSource = fs.readFileSync(path.join(projectRoot, 'app/js/local-bus-router.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(appSource.slice(
  appSource.indexOf('function navGetLatLon'),
  appSource.indexOf('function buildNavStopDists')
), sandbox);
vm.runInContext(`
  const navManeuverAudioNodes = new Set();
  const NAV_MANEUVER_BEEPS_STORAGE_KEY = 'lehrfahrer-nav-maneuver-beeps';
  const NAV_MANEUVER_VOLUME_STORAGE_KEY = 'lehrfahrer-nav-maneuver-volume';
  const NAV_MANEUVER_VOLUME_DEFAULT = 70;
  const NAV_MANEUVER_PEAK_GAIN = 0.16;
  const navLineManeuverAudioState = {
    maneuverAudio: { turnKey: null, warningPlayed: false, retryAt: 0 }
  };
`, sandbox);
vm.runInContext(appSource.slice(
  appSource.indexOf('function getTurnInfo'),
  appSource.indexOf('const NAV_MANEUVER_SVG')
), sandbox);
vm.runInContext(appSource.slice(
  appSource.indexOf('function isNavManeuverBeepsEnabled'),
  appSource.indexOf('function playNavOffRouteWarning')
), sandbox);
vm.runInContext(routerSource, sandbox);

const routing = sandbox.LehrfahrerLocalBusRouting;

function pointAt(metersNorth, metersEast = 0) {
  return [51.75 + metersNorth / 111320, 14.33 + metersEast / 70000];
}

function createRoundaboutRouter(firstExit = 'blocked', reverseExit = false) {
  const routePoints = [0, 10, 20, 30, 40].map(distance => pointAt(distance));
  const graphNode = (id, point) => ({ id, lat: point[0], lon: point[1] });
  const nodes = [
    graphNode('approach', routePoints[0]),
    graphNode('entry', routePoints[1]),
    graphNode('ring-1', routePoints[2]),
    graphNode('ring-2', routePoints[3]),
    graphNode('exit', routePoints[4]),
    graphNode('side-1', pointAt(20, 40)),
    graphNode('side-reverse', pointAt(20, -40))
  ];
  const edge = (id, from, to, options = {}) => ({
    id, from, to, oneway: true, roadClass: 'residential', use: 'residential',
    access: 'yes', motorVehicle: 'yes', bus: 'yes', ...options
  });
  const edges = [
    edge('approach-edge', 'approach', 'entry'),
    edge('ring-a', 'entry', 'ring-1'),
    edge('ring-b', 'ring-1', 'ring-2'),
    edge('berliner-ausfahrt', 'ring-2', 'exit', { name: 'Berliner Straße' })
  ];
  if (firstExit === 'allowed') {
    edges.push(edge('first-ausfahrt', 'ring-1', 'side-1'));
  } else if (firstExit === 'blocked') {
    edges.push(edge('first-ausfahrt', 'ring-1', 'side-1', { bus: 'no' }));
  }
  if (reverseExit) edges.push(edge('reverse-only', 'side-reverse', 'ring-1'));
  const router = routing.createRouter({
    formatVersion: 1,
    regionId: 'test',
    graphVersion: 'test',
    boundingBox: { minLat: 51.74, minLon: 14.32, maxLat: 51.76, maxLon: 14.34 },
    nodes,
    edges,
    turnRestrictions: []
  });
  const traversals = [
    { edgeId: 'approach-edge', fromNodeId: 'approach', toNodeId: 'entry' },
    { edgeId: 'ring-a', fromNodeId: 'entry', toNodeId: 'ring-1' },
    { edgeId: 'ring-b', fromNodeId: 'ring-1', toNodeId: 'ring-2' },
    { edgeId: 'berliner-ausfahrt', fromNodeId: 'ring-2', toNodeId: 'exit', name: 'Berliner Straße' }
  ];
  return { router, routePoints, traversals };
}

function ordinaryContext(incomingName, outgoing = {}) {
  const geometry = [pointAt(0), pointAt(10), pointAt(20)];
  const nodesById = new Map([
    ['before', { id: 'before', lat: geometry[0][0], lon: geometry[0][1] }],
    ['junction', { id: 'junction', lat: geometry[1][0], lon: geometry[1][1] }],
    ['after', { id: 'after', lat: geometry[2][0], lon: geometry[2][1] }]
  ]);
  const traversals = [
    { edgeId: 'incoming', fromNodeId: 'before', toNodeId: 'junction', name: incomingName },
    { edgeId: 'outgoing', fromNodeId: 'junction', toNodeId: 'after', ...outgoing }
  ];
  return { geometry, traversals, router: { nodesById } };
}

test('Rechts- und Linksabbiegen nennen die tatsächlich folgende Straße', () => {
  const right = ordinaryContext('Hauptstraße', { name: 'Bahnhofstraße' });
  const left = ordinaryContext('Hauptstraße', { name: 'Karl-Liebknecht-Straße' });
  assert.equal(sandbox.getBusRerouteTurnInfo(
    { angle: 90, index: 1 }, right.geometry, right.traversals, right.router
  ).label, 'Rechts abbiegen in die Bahnhofstraße');
  assert.equal(sandbox.getBusRerouteTurnInfo(
    { angle: -90, index: 1 }, left.geometry, left.traversals, left.router
  ).label, 'Links abbiegen in die Karl-Liebknecht-Straße');
});

test('sinnvolle ref dient als Fallback; namenlose und identische Straßen bleiben neutral', () => {
  const ref = ordinaryContext('Hauptstraße', { ref: 'B 169' });
  const unnamed = ordinaryContext('Hauptstraße');
  const sameStreet = ordinaryContext('Bahnhofstraße', { name: 'Bahnhofstraße' });
  assert.match(sandbox.getBusRerouteTurnInfo(
    { angle: 90, index: 1 }, ref.geometry, ref.traversals, ref.router
  ).label, /B 169/);
  assert.equal(sandbox.getBusRerouteTurnInfo(
    { angle: 90, index: 1 }, unnamed.geometry, unnamed.traversals, unnamed.router
  ).label, 'Rechts abbiegen');
  assert.equal(sandbox.getBusRerouteTurnInfo(
    { angle: 90, index: 1 }, sameStreet.geometry, sameStreet.traversals, sameStreet.router
  ), null);
});

test('Kreisverkehr zählt nur zulässige gerichtete Ausfahrten und nennt die Ausfahrtsstraße', () => {
  const first = createRoundaboutRouter('blocked', true);
  const firstTraversals = first.traversals.slice(0, 3).map(traversal =>
    traversal.edgeId === 'ring-b' ? { ...traversal, name: 'Berliner Straße' } : traversal
  );
  const firstInfo = sandbox.getBusRerouteTurnInfo(
    { type: 'roundabout', angle: 0, index: 1, endIndex: 2 },
    first.routePoints.slice(0, 4), firstTraversals, first.router
  );
  assert.equal(firstInfo.label, 'Im Kreisverkehr die 1. Ausfahrt Richtung Berliner Straße nehmen');

  const second = createRoundaboutRouter('allowed', true);
  const secondInfo = sandbox.getBusRerouteTurnInfo(
    { type: 'roundabout', angle: 0, index: 1, endIndex: 3 },
    second.routePoints, second.traversals, second.router
  );
  assert.equal(secondInfo.label, 'Im Kreisverkehr die 2. Ausfahrt Richtung Berliner Straße nehmen');
  assert.equal(second.router.getEligibleOutgoingEdges('ring-1').some(edge => edge.id === 'reverse-only'), false);
  assert.equal(second.router.getEligibleOutgoingEdges('ring-1').some(edge => edge.id === 'first-ausfahrt'), true);
});

test('gesperrte Ausfahrt wird nicht mitgezählt und unbenannte Ausfahrt bleibt neutral', () => {
  const { router, routePoints, traversals } = createRoundaboutRouter('blocked');
  const unnamedTraversals = traversals.map(traversal => ({ ...traversal, name: null, ref: null }));
  const info = sandbox.getBusRerouteTurnInfo(
    { type: 'roundabout', angle: 0, index: 1, endIndex: 3 },
    routePoints, unnamedTraversals, router
  );
  assert.equal(info.label, 'Im Kreisverkehr die 1. Ausfahrt nehmen');
  assert.equal(router.getEligibleOutgoingEdges('ring-1').some(edge => edge.id === 'first-ausfahrt'), false);
});

function createAudioContextRecorder() {
  const frequencies = [];
  const gainValues = [];
  const oscillators = [];
  return {
    frequencies,
    gainValues,
    oscillators,
    state: 'running',
    currentTime: 10,
    destination: {},
    createOscillator() {
      const oscillator = {
        frequency: { setValueAtTime: value => frequencies.push(value) },
        connect() {}, disconnect() {}, start() {},
        stop() { this.stopped = true; }
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain() {
      return {
        gain: {
          setValueAtTime(value) { gainValues.push(value); },
          exponentialRampToValueAtTime(value) { gainValues.push(value); }
        },
        connect() {}, disconnect() {}
      };
    }
  };
}

function createCueState(turn) {
  return {
    turns: [turn],
    maneuverAudio: { turnKey: null, warningPlayed: false, retryAt: 0 }
  };
}

function configureCueSandbox({ enabled = true, offRoute = false, busyUntil = 0 } = {}) {
  const toggle = { checked: enabled };
  sandbox.document = { getElementById: id => id === 'navManeuverBeepsEnabled' ? toggle : null };
  sandbox.navOffRouteActive = offRoute;
  sandbox.navWarningAudioBusyUntil = busyUntil;
  sandbox.navActiveBusReroute = null;
  return toggle;
}

test('rechts, links und Kreisverkehr erzeugen eindeutig unterscheidbare Tonmuster', () => {
  const context = createAudioContextRecorder();
  sandbox.navWarningAudioContext = context;
  assert.equal(sandbox.playNavManeuverTone({ angle: 90 }), true);
  assert.deepEqual(context.frequencies.splice(0), [880, 1040]);
  assert.equal(sandbox.playNavManeuverTone({ angle: -90 }), true);
  assert.deepEqual(context.frequencies.splice(0), [660, 560]);
  assert.equal(sandbox.playNavManeuverTone({ type: 'roundabout', angle: 0 }), true);
  assert.deepEqual(context.frequencies.splice(0), [760, 860, 960]);
});

test('normale aktive Navigation nutzt dieselbe einmalige Cue-Logik', () => {
  configureCueSandbox();
  sandbox.navWarningAudioContext = createAudioContextRecorder();
  sandbox.navActive = true;
  sandbox.navPaused = false;
  sandbox.navActiveBusReroute = null;
  vm.runInContext('resetBusRerouteManeuverAudio(navLineManeuverAudioState)', sandbox);
  const turn = { index: 4, angle: 90, distFromStart: 500 };

  assert.equal(sandbox.maybePlayLineNavigationManeuverCue(turn, 300), true);
  assert.equal(sandbox.maybePlayLineNavigationManeuverCue(turn, 290), false);
  assert.deepEqual(sandbox.navWarningAudioContext.frequencies, [880, 1040]);

  const toggle = configureCueSandbox({ enabled: false });
  vm.runInContext('resetBusRerouteManeuverAudio(navLineManeuverAudioState)', sandbox);
  assert.equal(sandbox.maybePlayLineNavigationManeuverCue(turn, 300), false);
  toggle.checked = true;
  assert.equal(sandbox.maybePlayLineNavigationManeuverCue(turn, 300), true);

  configureCueSandbox();
  sandbox.navActive = false;
  vm.runInContext('resetBusRerouteManeuverAudio(navLineManeuverAudioState)', sandbox);
  assert.equal(sandbox.maybePlayLineNavigationManeuverCue(turn, 300), false);
  sandbox.navActive = true;
  sandbox.navPaused = true;
  assert.equal(sandbox.maybePlayLineNavigationManeuverCue(turn, 300), false);
});

test('Preview bleibt stumm; aktive Rückführung spielt denselben Turn höchstens einmal', () => {
  configureCueSandbox();
  sandbox.navWarningAudioContext = createAudioContextRecorder();
  const turn = { index: 4, angle: 90, distFromStart: 500 };
  const state = createCueState(turn);
  assert.equal(sandbox.maybePlayBusRerouteManeuverCue(state, turn, 300), false);
  sandbox.navActiveBusReroute = state;
  assert.equal(sandbox.maybePlayBusRerouteManeuverCue(state, turn, 200), false);
  assert.equal(sandbox.navWarningAudioContext.frequencies.length, 0);
  assert.equal(sandbox.maybePlayBusRerouteManeuverCue(state, turn, 300), true);
  assert.equal(sandbox.maybePlayBusRerouteManeuverCue(state, turn, 290), false);
  assert.equal(sandbox.navWarningAudioContext.frequencies.length, 2);

  const nextTurn = { index: 5, angle: -90, distFromStart: 800 };
  state.turns.push(nextTurn);
  assert.equal(sandbox.maybePlayBusRerouteManeuverCue(state, nextTurn, 600), true);
  assert.equal(sandbox.navWarningAudioContext.frequencies.length, 4);

  const thirdTurn = { index: 8, type: 'roundabout', angle: 0, distFromStart: 1100 };
  state.turns.push(thirdTurn);
  assert.equal(sandbox.maybePlayBusRerouteManeuverCue(state, thirdTurn, 900), true);
  assert.equal(sandbox.maybePlayBusRerouteManeuverCue(state, thirdTurn, 900), false);
  assert.equal(sandbox.navWarningAudioContext.frequencies.length, 7);
});

test('Einstellung und laufendes Warnsignal unterdrücken Manövertöne', () => {
  const turn = { index: 1, angle: 90, distFromStart: 100 };
  const context = createAudioContextRecorder();
  sandbox.navWarningAudioContext = context;

  configureCueSandbox({ enabled: false });
  let state = createCueState(turn);
  sandbox.navActiveBusReroute = state;
  assert.equal(sandbox.maybePlayBusRerouteManeuverCue(state, turn, 0), false);

  configureCueSandbox({ busyUntil: Date.now() + 1000 });
  state = createCueState(turn);
  sandbox.navActiveBusReroute = state;
  assert.equal(sandbox.maybePlayBusRerouteManeuverCue(state, turn, 0), false);
  assert.equal(context.frequencies.length, 0);
});

test('OFF-Route blockiert Cues nur waehrend des Warnsignals, nicht fuer den ganzen Reroute', () => {
  const turn = { index: 4, angle: 90, distFromStart: 100 };
  const context = createAudioContextRecorder();
  sandbox.navWarningAudioContext = context;
  configureCueSandbox({ offRoute: true, busyUntil: Date.now() + 1000 });
  const state = createCueState(turn);
  sandbox.navActiveBusReroute = state;

  assert.equal(sandbox.maybePlayBusRerouteManeuverCue(state, turn, 0), false);
  assert.equal(state.maneuverAudio.warningPlayed, false);

  sandbox.navWarningAudioBusyUntil = 0;
  assert.equal(sandbox.maybePlayBusRerouteManeuverCue(state, turn, 0), true);
  assert.equal(sandbox.maybePlayBusRerouteManeuverCue(state, turn, 0), false);
  assert.equal(context.frequencies.length, 2);
});

test('Lautstaerke skaliert nur den gemeinsamen Manoever-Gain von 0 bis 100 Prozent', () => {
  const slider = { value: '100' };
  sandbox.document = { getElementById: id => id === 'navManeuverVolume' ? slider : null };
  let context = createAudioContextRecorder();
  sandbox.navWarningAudioContext = context;
  assert.equal(sandbox.playNavManeuverTone({ angle: 90 }), true);
  assert.ok(context.gainValues.includes(0.16));

  slider.value = '50';
  context = createAudioContextRecorder();
  sandbox.navWarningAudioContext = context;
  assert.equal(sandbox.playNavManeuverTone({ angle: 90 }), true);
  assert.ok(context.gainValues.includes(0.08));

  slider.value = '0';
  context = createAudioContextRecorder();
  sandbox.navWarningAudioContext = context;
  assert.equal(sandbox.playNavManeuverTone({ angle: 90 }), true);
  assert.equal(context.oscillators.length, 0);
});

test('Audio-Unlock-Fehler stürzt nicht ab und derselbe Cue kann später funktionieren', () => {
  configureCueSandbox();
  const turn = { index: 2, angle: 90, distFromStart: 100 };
  const state = createCueState(turn);
  sandbox.navActiveBusReroute = state;
  sandbox.navWarningAudioContext = null;
  sandbox.prepareNavWarningAudio = () => { throw new Error('unlock denied'); };
  assert.doesNotThrow(() => sandbox.maybePlayBusRerouteManeuverCue(state, turn, 0));
  assert.equal(state.maneuverAudio.warningPlayed, false);

  sandbox.navWarningAudioContext = createAudioContextRecorder();
  assert.equal(sandbox.maybePlayBusRerouteManeuverCue(state, turn, 0), true);
});

test('Manöver-Audioeinstellung ist standardmäßig an und wird gespeichert', () => {
  const values = new Map();
  const handlers = {};
  const toggle = {
    checked: false,
    addEventListener: (name, handler) => { handlers[name] = handler; }
  };
  const volumeHandlers = {};
  const volume = {
    value: '',
    addEventListener: (name, handler) => { volumeHandlers[name] = handler; }
  };
  const volumeValue = { textContent: '' };
  sandbox.document = { getElementById: id => ({
    navManeuverBeepsEnabled: toggle,
    navManeuverVolume: volume,
    navManeuverVolumeValue: volumeValue
  }[id] || null) };
  sandbox.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  sandbox.initializeNavManeuverBeepsSetting();
  assert.equal(toggle.checked, true);
  assert.equal(volume.value, '70');
  assert.equal(volumeValue.textContent, '70 %');
  toggle.checked = false;
  handlers.change();
  assert.equal(values.get('lehrfahrer-nav-maneuver-beeps'), '0');
  for (const value of ['0', '50', '100']) {
    volume.value = value;
    volumeHandlers.input();
    assert.equal(values.get('lehrfahrer-nav-maneuver-volume'), value);
    assert.equal(volumeValue.textContent, `${value} %`);
  }

  const restoredVolume = { value: '', addEventListener() {} };
  sandbox.document = { getElementById: id => ({
    navManeuverBeepsEnabled: toggle,
    navManeuverVolume: restoredVolume,
    navManeuverVolumeValue: volumeValue
  }[id] || null) };
  sandbox.initializeNavManeuverBeepsSetting();
  assert.equal(toggle.checked, false);
  assert.equal(restoredVolume.value, '100');
});

test('Abbiegealarmierung ist im allgemeinen Tablet-Einstellungsdialog sichtbar', () => {
  const generalSettings = appHtml.slice(
    appHtml.indexOf('<div id="settingsOverlay"'),
    appHtml.indexOf('<div id="navMenuOverlay"')
  );
  const navigationMenu = appHtml.slice(appHtml.indexOf('<div id="navMenuOverlay"'));

  assert.match(generalSettings, /id="navManeuverSettingsSection"/);
  assert.match(generalSettings, /id="navManeuverBeepsEnabled"[^>]*checked/);
  assert.match(generalSettings, /id="navManeuverVolume"[^>]*min="0"[^>]*max="100"[^>]*value="70"/);
  assert.match(generalSettings, /id="navManeuverVolumeValue"[^>]*>70 %</);
  assert.doesNotMatch(navigationMenu, /id="navManeuverBeepsEnabled"|id="navManeuverVolume"/);
  assert.equal((appHtml.match(/id="navManeuverBeepsEnabled"/g) || []).length, 1);
  assert.equal((appHtml.match(/id="navManeuverVolume"/g) || []).length, 1);
  assert.match(appCss, /\.nav-maneuver-volume-control[\s\S]*min-height:\s*44px/);
  assert.match(appSource.slice(
    appSource.indexOf('function openSettings'),
    appSource.indexOf('function closeSettings')
  ), /settingsOverlay\.classList\.remove\('hidden'\)/);
});

test('Rejoin-Reset löscht Cue-Zustand; OFF-Route-Warnpfad bleibt bestehen', () => {
  configureCueSandbox();
  const state = createCueState({ index: 3, angle: 90, distFromStart: 200 });
  state.maneuverAudio.warningPlayed = true;
  const context = createAudioContextRecorder();
  sandbox.navWarningAudioContext = context;
  sandbox.playNavManeuverTone({ angle: 90 });
  const oscillator = context.oscillators[0];
  assert.equal(typeof oscillator.onended, 'function');
  sandbox.resetBusRerouteManeuverAudio(state);
  assert.equal(oscillator.stopped, true);
  assert.equal(oscillator.onended, null);
  assert.deepEqual(JSON.parse(JSON.stringify(state.maneuverAudio)), {
    turnKey: null, warningPlayed: false, retryAt: 0
  });
  const warningSource = appSource.slice(
    appSource.indexOf('function playNavOffRouteWarning'),
    appSource.indexOf('function syncNavOffRouteUi')
  );
  assert.match(warningSource, /playNavWarningWebAudio\(\)/);
  assert.match(warningSource, /playNavWarningFallback\(\)/);
  const activeHudSource = appSource.slice(
    appSource.indexOf('function updateActiveBusRerouteHud'),
    appSource.indexOf('function requestBusReroute')
  );
  assert.match(activeHudSource, /maybePlayBusRerouteManeuverCue\(/);
  const lineHudSource = appSource.slice(
    appSource.indexOf('function updateNavHud'),
    appSource.indexOf('function checkNavDestinationReached')
  );
  assert.match(lineHudSource, /maybePlayLineNavigationManeuverCue\(/);
});

function createManeuverTestControls(enabled = true) {
  const handlers = {};
  const toggleHandlers = {};
  const toggle = {
    checked: enabled,
    addEventListener: (name, handler) => { toggleHandlers[name] = handler; }
  };
  const buttons = Object.fromEntries([
    'navManeuverTestRight',
    'navManeuverTestLeft',
    'navManeuverTestRoundabout'
  ].map(id => [id, {
    disabled: false,
    addEventListener: (name, handler) => { handlers[id] = handler; }
  }]));
  const values = new Map();
  if (!enabled) values.set('lehrfahrer-nav-maneuver-beeps', '0');
  sandbox.document = {
    getElementById: id => id === 'navManeuverBeepsEnabled' ? toggle : (buttons[id] || null)
  };
  sandbox.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  return { buttons, handlers, toggle, toggleHandlers, values };
}

test('Einstellungs-Testbuttons spielen genau die vorhandenen Rechts-, Links- und Kreisverkehrsmuster', async () => {
  const controls = createManeuverTestControls();
  const context = createAudioContextRecorder();
  let unlockCalls = 0;
  sandbox.prepareNavWarningAudio = () => { unlockCalls++; return context; };
  sandbox.navWarningAudioContext = context;
  sandbox.initializeNavManeuverBeepsSetting();

  await controls.handlers.navManeuverTestRight();
  assert.deepEqual(context.frequencies.splice(0), [880, 1040]);
  await controls.handlers.navManeuverTestLeft();
  assert.deepEqual(context.frequencies.splice(0), [660, 560]);
  await controls.handlers.navManeuverTestRoundabout();
  assert.deepEqual(context.frequencies.splice(0), [760, 860, 960]);
  assert.equal(unlockCalls, 3);
});

test('ausgeschaltete Pieptöne deaktivieren Testbuttons und verhindern Testaudio', async () => {
  const controls = createManeuverTestControls(false);
  const context = createAudioContextRecorder();
  sandbox.navWarningAudioContext = context;
  sandbox.prepareNavWarningAudio = () => context;
  sandbox.initializeNavManeuverBeepsSetting();
  assert.ok(Object.values(controls.buttons).every(button => button.disabled));
  assert.equal(await sandbox.playNavManeuverTestTone({ angle: 90 }), false);
  assert.equal(context.frequencies.length, 0);
});

test('Testbuttons verändern Rückführungszustand nicht und gesperrter AudioContext crasht nicht', async () => {
  const controls = createManeuverTestControls();
  const routeState = {
    geometry: [[1, 2], [3, 4]],
    nearestIdx: 0,
    maneuverAudio: { turnKey: '5', warningPlayed: false, retryAt: 0 }
  };
  sandbox.navActiveBusReroute = routeState;
  const before = JSON.stringify(routeState);
  const suspendedContext = {
    state: 'suspended',
    resume: () => Promise.reject(new Error('Audio gesperrt'))
  };
  sandbox.prepareNavWarningAudio = () => suspendedContext;
  sandbox.initializeNavManeuverBeepsSetting();
  assert.equal(await controls.handlers.navManeuverTestRight(), false);
  assert.equal(JSON.stringify(routeState), before);
  assert.equal(sandbox.navActiveBusReroute, routeState);
});
