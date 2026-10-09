const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.resolve(__dirname, '../app/js/app.js'), 'utf8');
const editorUiSource = fs.readFileSync(path.resolve(__dirname, '../js/editor.ui.js'), 'utf8');
const editorMainSource = fs.readFileSync(path.resolve(__dirname, '../js/editor.main.js'), 'utf8');
const payload = '<img src=x onerror="window.__xss_test=1"> & < > " \' äöü ' + 'L'.repeat(500);
const displayValues = ['Linie 15', 'Cottbus Süd', '& < > " \'', 'L'.repeat(1000), payload];

function createDom(windowObject) {
  const created = [];
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.style = {};
      this.className = '';
      this.classList = { add() {}, remove() {} };
      this._textContent = '';
      this._innerHTML = '';
    }
    set textContent(value) { this._textContent = String(value); }
    get textContent() { return this._textContent; }
    set innerHTML(value) {
      this._innerHTML = String(value);
      this.children = [];
      if (/onerror\s*=|<script/i.test(this._innerHTML)) windowObject.__xss_test = 1;
    }
    get innerHTML() { return this._innerHTML; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    addEventListener() {}
    click() {}
  }
  return {
    created,
    createElement(tagName) {
      const element = new Element(tagName);
      created.push(element);
      return element;
    },
    createTextNode(value) { return { nodeType: 3, textContent: String(value), children: [] }; }
  };
}

function nodeText(node) {
  return [node?.textContent || '', ...(node?.children || []).map(nodeText)].join('');
}

test('Downloadcenter rendert manipulierte Linien-, Routen- und Ortsnamen nur als Text', async () => {
  const windowObject = { __xss_test: 0 };
  const dom = createDom(windowObject);
  const modal = dom.createElement('div');
  const container = dom.createElement('div');
  const elements = { downloadCenterModal: modal, linesListContainer: container };
  const context = {
    window: windowObject,
    document: {
      createElement: dom.createElement,
      getElementById: id => elements[id] || null,
      querySelectorAll: () => []
    },
    console: { log() {} },
    availableLinesCatalog: displayValues.map((value, index) => ({
      id: `xss-line-${index}`,
      lineName: value,
      routeName: value,
      city: value
    })),
    fetchAndCacheLinesCatalog: async () => [],
    dbGetLinesCatalog: async () => [],
    hideBanner() {},
    updateDownloadStats() {},
    startLinesDownload() {},
    String
  };
  vm.createContext(context);
  vm.runInContext(appSource.slice(
    appSource.indexOf('async function showDownloadCenterModal'),
    appSource.indexOf('async function updateDownloadStats')
  ), context);

  await context.showDownloadCenterModal();

  assert.equal(windowObject.__xss_test, 0);
  assert.equal(container.children.length, displayValues.length);
  displayValues.forEach((value, index) => {
    const label = container.children[index].children[1];
    assert.equal(label.children[0].textContent, value);
    assert.equal(label.children[1].textContent, `${value} • ${value}`);
  });
});

test('Offline-Linienliste rendert Namen, Varianten und Sonderzeichen nur als Text', async () => {
  const windowObject = { __xss_test: 0 };
  const dom = createDom(windowObject);
  const container = dom.createElement('div');
  const request = { result: [{ id: 'xss-line', data: { lineName: payload, routeType: 'line' } }] };
  Object.defineProperty(request, 'onsuccess', { set(handler) { queueMicrotask(handler); } });
  Object.defineProperty(request, 'onerror', { set() {} });
  const context = {
    window: windowObject,
    document: { createElement: dom.createElement },
    console: { error() {} },
    availableLinesContainer: container,
    availableLinesCatalog: [],
    requireDB: () => ({ transaction: () => ({ objectStore: () => ({ getAll: () => request }) }) }),
    buildLineStorageId: line => line.id,
    normalizeOperationalRouteType: () => 'line',
    getAppVariantName: () => payload,
    getAppVariantCategory: () => payload,
    getAppLineDescription: () => '',
    formatAppValidity: () => '',
    dbGetLinePDFRecord: async () => null,
    openLineOverviewPdf: async () => {},
    Promise,
    String
  };
  vm.createContext(context);
  vm.runInContext(appSource.slice(
    appSource.indexOf('async function displayAvailableLines'),
    appSource.indexOf('async function openLineOverviewPdf')
  ), context);

  await context.displayAvailableLines();

  assert.equal(windowObject.__xss_test, 0);
  assert.equal(container.children.length, 1);
  const textWrap = container.children[0].children[1];
  assert.equal(textWrap.children[0].textContent, payload);
  assert.equal(textWrap.children[1].textContent, `${payload} -> ${payload}`);
});

test('gleichartiger Editor-Speichern-Toast interpretiert fileBase und city nicht als HTML', () => {
  const windowObject = { __xss_test: 0 };
  const dom = createDom(windowObject);
  let toast = null;
  const context = {
    window: windowObject,
    document: {
      createElement: tagName => {
        const element = dom.createElement(tagName);
        if (!toast && tagName === 'div') toast = element;
        return element;
      },
      createTextNode: dom.createTextNode,
      getElementById: id => id === 'saveToast' ? toast : null,
      body: { appendChild() {} }
    },
    requestAnimationFrame: callback => callback(),
    setTimeout: () => 1,
    clearTimeout() {},
    Date,
    String
  };
  vm.createContext(context);
  vm.runInContext(editorUiSource.slice(
    editorUiSource.indexOf('let _saveToastTimer'),
    editorUiSource.indexOf('function updateRouteStats')
  ), context);

  context.showSaveToast({ fileBase: payload, city: payload, stopCount: 1, routePointCount: 2 });

  assert.equal(windowObject.__xss_test, 0);
  assert.match(nodeText(toast), new RegExp(payload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('gleichartiger Editor-Eingabedialog trennt statisches HTML von Ortsnamen', () => {
  const modalSource = editorMainSource.slice(
    editorMainSource.indexOf('function askTextInputModal'),
    editorMainSource.indexOf('function showConfirmDialog')
  );
  assert.ok(modalSource.includes('box.querySelector("#promptFallbackMessage").textContent = message || ""'));
  assert.ok(modalSource.includes('input.placeholder = placeholder || ""'));
  assert.ok(!modalSource.includes('${message || ""}'));
  assert.ok(!modalSource.includes('${placeholder || ""}'));
});
