const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const editor = fs.readFileSync(path.resolve(__dirname, '../js/editor.api.js'), 'utf8');
const start = editor.indexOf('function renderGtfsChangeAnalysis(analysis) {');
const end = editor.indexOf('\nfunction gtfsWorkStatusLabel(', start);
assert.ok(start >= 0 && end > start);
const renderSource = editor.slice(start, end);

function element() {
  const classes = new Set();
  return {
    children: [], textContent: '', disabled: false, dataset: {},
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
    },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {},
    querySelectorAll() { return []; }
  };
}

function view(request) {
  const ids = ['gtfsChangeModal', 'gtfsChangeBaseline', 'gtfsChangeSummary', 'gtfsChangeList',
    'gtfsChangeReport', 'gtfsChangeDiagnostics', 'gtfsCandidateVersionInfo',
    'gtfsCandidateAdoptBtn', 'gtfsCandidateStatus', 'gtfsChangeCloseBtn', 'gtfsComparisonCheckBtn'];
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  const context = {
    document: {
      getElementById: id => elements[id],
      createElement: () => element(),
      createTextNode: text => ({ textContent: text })
    },
    gtfsChangeElement: (_tag, className, text) => {
      const node = element();
      node.className = className;
      node.textContent = text;
      return node;
    },
    loadGtfsVersionInfo() {},
    postGtfsImport: request,
    setStatus() {},
    confirm() { throw new Error('Adoption must not start in this test'); }
  };
  const render = vm.runInNewContext(`${renderSource}; renderGtfsChangeAnalysis`, context);
  return { render, elements };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const summary = elements => elements.gtfsChangeSummary;
const labels = elements => summary(elements).children.map(child => child.textContent);

test('kein oder ungültiger Kandidat zeigt Hinweis statt Vergleichskacheln', async () => {
  for (const reason of ['Kein persistierter GTFS-Kandidat vorhanden.',
    'Aktueller GTFS-Stand hat sich seit der Kandidatenpruefung geaendert.']) {
    const { render, elements } = view(async () => ({ ready: false, reason }));
    render({ candidateChecked: false, candidateReady: false, lines: [], lineCounts: {} });
    await settle();
    assert.deepEqual(labels(elements), ['Kein neuer Fahrplanstand zur Prüfung vorhanden.']);
    assert.equal(elements.gtfsCandidateStatus.textContent, reason);
    assert.equal(elements.gtfsCandidateAdoptBtn.disabled, true);
    assert.equal(elements.gtfsChangeList.children.length, 0);
  }
});

test('serverseitiger Vergleichsfehler zeigt Fehler statt Kandidatenhinweis', async () => {
  const { render, elements } = view(async () => ({ ready: false, reason: 'Vergleich fehlgeschlagen.' }));
  render({ candidateChecked: false, candidateReady: false, lines: [], lineCounts: {} });
  await settle();
  assert.deepEqual(labels(elements), ['Kandidatenprüfung fehlgeschlagen: Vergleich fehlgeschlagen.']);
  assert.equal(elements.gtfsCandidateAdoptBtn.disabled, true);
});

test('ausstehender Vergleich zeigt keine fachlichen Nullwerte', () => {
  const { render, elements } = view(() => new Promise(() => {}));
  render({ candidateChecked: false, candidateReady: false, lines: [], lineCounts: {} });
  assert.deepEqual(labels(elements), ['Kandidatenprüfung läuft …']);
  assert.equal(elements.gtfsCandidateAdoptBtn.disabled, true);
});

test('erfolgreicher Vergleich zeigt echte Nullwerte und kann Übernahme freigeben', async () => {
  const { render, elements } = view(async () => ({
    ready: true, candidateId: 'checked-candidate', changeAnalysis: {
      candidateValidLines: 77, candidateVariantCount: 757, lines: [],
      lineCounts: { NEU: 0, GEAENDERT: 0, ENTFALLEN: 0, PRUEFEN: 0 }
    }
  }));
  render({ candidateChecked: false, candidateReady: false, lines: [], lineCounts: {} });
  await settle();
  const cards = summary(elements).children;
  assert.equal(cards.length, 6);
  assert.deepEqual(cards.map(card => card.children[0].textContent), ['77', '757', '0', '0', '0', '0']);
  assert.equal(elements.gtfsCandidateAdoptBtn.disabled, false);
});

test('Vergleichsfehler zeigt Fehlermeldung statt Nullwerten und sperrt Übernahme', async () => {
  const { render, elements } = view(async () => { throw new Error('HTTP 500'); });
  render({ candidateChecked: false, candidateReady: false, lines: [], lineCounts: {} });
  await settle();
  assert.deepEqual(labels(elements), ['Kandidatenprüfung fehlgeschlagen: HTTP 500']);
  assert.equal(elements.gtfsCandidateAdoptBtn.disabled, true);
  assert.equal(elements.gtfsChangeList.children.length, 0);
});

test('erneute Prüfung blendet alte Vergleichskacheln sofort aus', async () => {
  let requests = 0;
  const { render, elements } = view(async () => {
    requests++;
    if (requests === 1) return { ready: true, candidateId: 'checked-candidate',
      changeAnalysis: { candidateValidLines: 1, candidateVariantCount: 1, lines: [], lineCounts: {} } };
    return new Promise(() => {});
  });
  render({ candidateChecked: false, candidateReady: false, lines: [], lineCounts: {} });
  await settle();
  assert.equal(summary(elements).children.length, 6);
  elements.gtfsComparisonCheckBtn.onclick();
  assert.deepEqual(labels(elements), ['Kandidatenprüfung läuft …']);
  assert.equal(elements.gtfsCandidateAdoptBtn.disabled, true);
});
