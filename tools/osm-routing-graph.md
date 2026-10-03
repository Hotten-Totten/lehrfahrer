# OSM LocalBusRouter Graph

This build-time tool converts a bounded local OSM XML extract into the existing LocalBusRouter graph format v1. It uses only Python's standard library and makes no network requests. The generated graph is a routing-only data source; it does not provide map tiles, styles, or visible map content.

The visible driver map remains the existing MapLibre rendering backed by PMTiles. A future distribution can install the PMTiles map package and this routing graph separately on the tablet for fully offline use. This change does not add app-side graph installation or change either package's lifecycle.

## Input

The builder reads `.osm` or `.xml`. For a local PBF extract, convert it before running the builder, for example with the local `osmium-tool`:

```powershell
osmium cat cottbus.osm.pbf -o cottbus.osm
```

Then build a region graph with a west,south,east,north bounding box:

```powershell
python tools/build_osm_routing_graph.py `
  --input cottbus.osm `
  --output region-routing-graph.json `
  --region-id cottbus-test `
  --graph-version 1 `
  --bbox 14.10,51.60,14.65,51.90
```

Only OSM segments with both endpoint nodes inside the bounding box are emitted. Choose the extract and box with enough margin for the intended routing area. Region IDs and extents are caller supplied; Cottbus is not hard-coded.

## Mapping

The builder emits compact node and directed-edge IDs in the `formatVersion: 1` schema. It retains the router's normalized `roadClass`, `use`, access fields, meters-based dimensions, surface, track type, lanes, speed, name, and ref. Vehicle access tags are kept as normalized values so the router can reject explicit prohibitions; more-specific bus/PSV permission takes precedence over general vehicle/access prohibitions. `destination`, `delivery`, and `customers` remain distinct restricted values, not unconditional permission. Missing or unparseable dimensions are `null`.

Explicit one-way values `yes`, `1`, `true`, `-1`, and `no` are handled. Motorways and roundabouts are implicitly forward-only unless explicitly `oneway=no`. Unknown explicit one-way values and ways with `oneway:conditional` are omitted instead of being made bidirectional. Ways with conditional access tags are also omitted because the router has no time-of-day context.

Via-node restrictions for `no_left_turn`, `no_right_turn`, `no_u_turn`, `no_straight_on`, `only_left_turn`, `only_right_turn`, and `only_straight_on` are resolved to directed edge IDs. Via-way and conditional restrictions are not supported; skipped relations are included in the build statistics. A relation with an ambiguous or out-of-bounds edge mapping is also skipped and counted.

## Controlled Test

`tools/fixtures/osm-routing-cases.osm` is a small synthetic OSM-XML fixture located in a Cottbus-area bounding box. It covers ordinary and restricted access, directionality, dimensions, road classes, a bus-permitted footway, and turn restrictions. It is not a downloaded real-world OSM extract and does not certify regional completeness.

Run the builder and LocalBusRouter compatibility regressions with:

```powershell
node --test tools/osm-routing-graph.test.js tools/navigation-local-bus-router.test.js
```

The graph is generated into the operating system's temporary directory by the test and is not installed in the app.
