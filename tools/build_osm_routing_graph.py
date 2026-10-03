#!/usr/bin/env python3
"""Build a compact LocalBusRouter v1 graph from bounded OSM XML."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

FORMAT_VERSION = 1
ROAD_CLASSES = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
    "residential", "living_street", "service", "road"
}
SPECIAL_CLASSES = {"footway", "pedestrian", "cycleway", "path", "steps", "bridleway", "track"}
EXPLICIT_ALLOW = {"yes", "permissive", "designated"}
HARD_DENY = {"no", "private", "prohibited", "closed"}
RESTRICTIONS = {
    "no_left_turn": ("no_turn", "left"),
    "no_right_turn": ("no_turn", "right"),
    "no_u_turn": ("no_turn", "u_turn"),
    "no_straight_on": ("no_turn", "straight"),
    "only_left_turn": ("only_turn", "left"),
    "only_right_turn": ("only_turn", "right"),
    "only_straight_on": ("only_turn", "straight")
}
EARTH_RADIUS_M = 6371008.8


def normalized(value: str | None) -> str:
    return (value or "").strip().lower()


def osm_id_key(value: str) -> tuple[int, int | str]:
    try:
        return (0, int(value))
    except ValueError:
        return (1, value)


def parse_bbox(value: str) -> dict[str, float]:
    try:
        west, south, east, north = (float(part.strip()) for part in value.split(","))
    except (ValueError, TypeError) as exc:
        raise argparse.ArgumentTypeError("BBox muss west,south,east,north sein.") from exc
    if not all(math.isfinite(item) for item in (west, south, east, north)):
        raise argparse.ArgumentTypeError("BBox muss endliche Koordinaten enthalten.")
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise argparse.ArgumentTypeError("BBox ist außerhalb der Erde oder falsch sortiert.")
    return {"minLon": west, "minLat": south, "maxLon": east, "maxLat": north}


def parse_measure(value: str | None, dimension: str) -> float | None:
    if not value:
        return None
    text = value.strip().lower().replace(",", ".")
    if not text or text in {"none", "unknown", "default", "unsigned", "variable"} or ";" in text:
        return None
    number = r"(\d+(?:\.\d+)?)"
    feet = re.fullmatch(rf"\s*{number}\s*(?:ft|feet|foot|')\s*(?:(\d+(?:\.\d+)?)\s*(?:in|inch|\")\s*)?", text)
    if feet:
        result = float(feet.group(1)) * 0.3048 + float(feet.group(2) or 0) * 0.0254
    else:
        match = re.fullmatch(rf"\s*{number}\s*([a-z ]*)\s*", text)
        if not match:
            return None
        amount = float(match.group(1))
        unit = match.group(2).strip()
        if dimension in {"height", "width", "length"}:
            factors = {"": 1, "m": 1, "meter": 1, "meters": 1, "metre": 1, "metres": 1,
                       "cm": 0.01, "mm": 0.001, "ft": 0.3048, "feet": 0.3048, "foot": 0.3048,
                       "in": 0.0254, "inch": 0.0254, "inches": 0.0254}
        else:
            factors = {"": 1, "t": 1, "ton": 1, "tons": 1, "tonne": 1, "tonnes": 1,
                       "kg": 0.001, "g": 0.000001, "lb": 0.00045359237, "lbs": 0.00045359237,
                       "st": 0.90718474, "short ton": 0.90718474, "short tons": 0.90718474}
        factor = factors.get(unit)
        if factor is None:
            return None
        result = amount * factor
    maximum = {"height": 100, "width": 20, "length": 100, "weight": 1000}[dimension]
    return result if math.isfinite(result) and 0 < result <= maximum else None


def parse_speed(value: str | None) -> float | None:
    if not value:
        return None
    text = value.strip().lower().replace(",", ".")
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(mph|mi/h|knots?|km/h|kph)?\s*", text)
    if not match:
        return None
    speed = float(match.group(1))
    unit = match.group(2) or "km/h"
    if unit in {"mph", "mi/h"}:
        speed *= 1.609344
    elif unit.startswith("knot"):
        speed *= 1.852
    return speed if math.isfinite(speed) and 0 < speed <= 300 else None


def parse_lanes(value: str | None) -> float | None:
    if not value or ";" in value:
        return None
    try:
        lanes = float(value)
    except ValueError:
        return None
    return lanes if math.isfinite(lanes) and 0 < lanes <= 100 else None


def parse_osm(path: Path) -> tuple[dict[str, tuple[float, float]], list[dict[str, Any]], list[dict[str, Any]]]:
    nodes: dict[str, tuple[float, float]] = {}
    ways: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    try:
        depth = 0
        root = None
        for event, element in ET.iterparse(path, events=("start", "end")):
            if event == "start":
                depth += 1
                if depth == 1:
                    root = element
                continue
            if depth == 2:
                if root is None or root.tag != "osm":
                    raise ValueError("Eingabe muss eine OSM-XML-Datei mit <osm>-Wurzel sein.")
                if element.tag == "node":
                    try:
                        nodes[element.attrib["id"]] = (float(element.attrib["lat"]), float(element.attrib["lon"]))
                    except (KeyError, ValueError):
                        pass
                elif element.tag == "way":
                    tags = {child.attrib["k"]: child.attrib["v"] for child in element if child.tag == "tag"}
                    if "highway" in tags:
                        ways.append({
                            "id": element.attrib.get("id", ""),
                            "nodes": [child.attrib["ref"] for child in element if child.tag == "nd"],
                            "tags": tags
                        })
                elif element.tag == "relation":
                    tags = {child.attrib["k"]: child.attrib["v"] for child in element if child.tag == "tag"}
                    if tags.get("type") == "restriction":
                        relations.append({
                            "tags": tags,
                            "members": [dict(child.attrib) for child in element if child.tag == "member"]
                        })
                root.remove(element)
            depth -= 1
    except (ET.ParseError, OSError) as exc:
        raise ValueError(f"OSM-XML konnte nicht gelesen werden: {exc}") from exc
    return nodes, ways, relations


def in_bbox(point: tuple[float, float], bbox: dict[str, float]) -> bool:
    lat, lon = point
    return bbox["minLat"] <= lat <= bbox["maxLat"] and bbox["minLon"] <= lon <= bbox["maxLon"]


def access_fields(tags: dict[str, str], highway: str) -> tuple[str, str, str]:
    access = normalized(tags.get("access")) or "unknown"
    vehicle = normalized(tags.get("motor_vehicle") or tags.get("vehicle")) or "unknown"
    bus = normalized(tags.get("bus") or tags.get("psv"))
    if not bus and vehicle in EXPLICIT_ALLOW:
        bus = vehicle
    if not bus and highway in SPECIAL_CLASSES and normalized(tags.get("motor_vehicle")) in EXPLICIT_ALLOW:
        bus = normalized(tags["motor_vehicle"])
    return access, vehicle, bus or "unknown"


def way_is_relevant(tags: dict[str, str]) -> bool:
    highway = normalized(tags.get("highway"))
    if highway in ROAD_CLASSES:
        return True
    if highway not in SPECIAL_CLASSES:
        return False
    return any(normalized(tags.get(key)) in EXPLICIT_ALLOW for key in ("motor_vehicle", "bus", "psv"))


def direction_mode(tags: dict[str, str]) -> str | None:
    if normalized(tags.get("oneway:conditional")):
        return None
    value = normalized(tags.get("oneway"))
    if value:
        if value in {"yes", "1", "true"}:
            return "forward"
        if value == "-1":
            return "reverse"
        if value in {"no", "0", "false"}:
            return "both"
        return None
    if normalized(tags.get("highway")) == "motorway" or normalized(tags.get("junction")) == "roundabout":
        return "forward"
    return "both"


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    value = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    return EARTH_RADIUS_M * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    delta_lon = lon2 - lon1
    y = math.sin(delta_lon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def turn_matches(kind: str, incoming: tuple[float, float], via: tuple[float, float], outgoing: tuple[float, float]) -> bool:
    delta = (bearing(via, outgoing) - bearing(incoming, via) + 540) % 360 - 180
    if kind == "left":
        return -170 < delta < -30
    if kind == "right":
        return 30 < delta < 170
    if kind == "u_turn":
        return abs(delta) >= 170
    return abs(delta) <= 30


def build_graph(
    input_path: Path,
    bbox: dict[str, float],
    region_id: str,
    graph_version: str
) -> tuple[dict[str, Any], dict[str, int]]:
    nodes, ways, relations = parse_osm(input_path)
    candidate_ways: list[dict[str, Any]] = []
    unsupported_oneway_count = 0
    unsupported_conditional_access_count = 0
    conditional_access_keys = {
        "access:conditional", "vehicle:conditional", "motor_vehicle:conditional",
        "bus:conditional", "psv:conditional"
    }
    for way in ways:
        if not way_is_relevant(way["tags"]):
            continue
        if conditional_access_keys.intersection(way["tags"]):
            unsupported_conditional_access_count += 1
            continue
        mode = direction_mode(way["tags"])
        if mode is not None:
            way["direction"] = mode
            candidate_ways.append(way)
        else:
            unsupported_oneway_count += 1

    edges: list[dict[str, Any]] = []
    used_node_ids: set[str] = set()
    way_edges: dict[str, list[dict[str, Any]]] = {}
    for way in sorted(candidate_ways, key=lambda item: osm_id_key(item["id"])):
        tags = way["tags"]
        highway = normalized(tags.get("highway"))
        access, motor_vehicle, bus = access_fields(tags, highway)
        directions = []
        if way["direction"] in {"forward", "both"}:
            directions.append(False)
        if way["direction"] in {"reverse", "both"}:
            directions.append(True)
        speed = parse_speed(tags.get("maxspeed"))
        for segment_index, (first, second) in enumerate(zip(way["nodes"], way["nodes"][1:])):
            if first not in nodes or second not in nodes or not in_bbox(nodes[first], bbox) or not in_bbox(nodes[second], bbox):
                continue
            length = haversine_m(nodes[first], nodes[second])
            if not math.isfinite(length) or length <= 0:
                continue
            used_node_ids.update((first, second))
            for reverse in directions:
                source, target = (second, first) if reverse else (first, second)
                edge = {
                    "id": f"e{len(edges)}",
                    "from": source,
                    "to": target,
                    "lengthMeters": round(length, 2),
                    "roadClass": highway,
                    "use": highway,
                    "oneway": True,
                    "access": access,
                    "motorVehicle": motor_vehicle,
                    "bus": bus,
                    "maxheight": parse_measure(tags.get("maxheight"), "height"),
                    "maxweight": parse_measure(tags.get("maxweight"), "weight"),
                    "maxwidth": parse_measure(tags.get("maxwidth"), "width"),
                    "maxlength": parse_measure(tags.get("maxlength"), "length"),
                    "surface": normalized(tags.get("surface")) or "unknown",
                    "tracktype": normalized(tags.get("tracktype")) or "unknown",
                    "lanes": parse_lanes(tags.get("lanes")),
                    "speedKph": speed,
                    "name": tags.get("name") or None,
                    "ref": tags.get("ref") or None,
                    "osmWayId": way["id"],
                    "segmentIndex": segment_index
                }
                edges.append(edge)
                way_edges.setdefault(way["id"], []).append({
                    "edge": edge,
                    "originalFrom": source,
                    "originalTo": target
                })

    compact_ids = {node_id: index for index, node_id in enumerate(sorted(used_node_ids, key=osm_id_key))}
    compact_nodes = [
        {"id": compact_ids[node_id], "lat": nodes[node_id][0], "lon": nodes[node_id][1]}
        for node_id in sorted(used_node_ids, key=osm_id_key)
    ]
    compact_edges = []
    for edge in edges:
        compact_edges.append({
            **{key: value for key, value in edge.items() if key not in {"osmWayId", "segmentIndex"}},
            "from": compact_ids[edge["from"]],
            "to": compact_ids[edge["to"]]
        })

    edge_lookup = {edge["id"]: edge for edge in edges}
    restrictions: list[dict[str, Any]] = []
    unsupported_restrictions = 0
    ignored_bus_exceptions = 0
    for relation in relations:
        tags = relation["tags"]
        if tags.get("restriction:conditional"):
            unsupported_restrictions += 1
            continue
        restriction_value = normalized(tags.get("restriction:bus") or tags.get("restriction:psv") or tags.get("restriction"))
        exception_values = {normalized(part) for part in re.split(r"[;,]", tags.get("except", "")) if part.strip()}
        if "bus" in exception_values or "psv" in exception_values:
            ignored_bus_exceptions += 1
            continue
        if restriction_value not in RESTRICTIONS:
            if restriction_value:
                unsupported_restrictions += 1
            continue
        restriction_type, turn_kind = RESTRICTIONS[restriction_value]
        from_members = [member for member in relation["members"] if member.get("role") == "from" and member.get("type") == "way"]
        to_members = [member for member in relation["members"] if member.get("role") == "to" and member.get("type") == "way"]
        via_nodes = [member for member in relation["members"] if member.get("role") == "via" and member.get("type") == "node"]
        has_via_way = any(member.get("role") == "via" and member.get("type") == "way" for member in relation["members"])
        if has_via_way or len(from_members) != 1 or len(to_members) != 1 or len(via_nodes) != 1:
            unsupported_restrictions += 1
            continue
        via_id = via_nodes[0].get("ref", "")
        via_point = nodes.get(via_id)
        from_edges = [item for item in way_edges.get(from_members[0].get("ref", ""), []) if item["originalTo"] == via_id]
        to_edges = [item for item in way_edges.get(to_members[0].get("ref", ""), []) if item["originalFrom"] == via_id]
        if not via_point or not in_bbox(via_point, bbox) or not from_edges or not to_edges:
            unsupported_restrictions += 1
            continue
        relation_added = False
        for from_item in from_edges:
            incoming_point = nodes[from_item["originalFrom"]]
            matching_to = [item for item in to_edges if turn_matches(turn_kind, incoming_point, via_point, nodes[item["originalTo"]])]
            if not matching_to:
                continue
            for to_item in matching_to:
                restrictions.append({
                    "fromEdgeId": from_item["edge"]["id"],
                    "viaNodeId": compact_ids[via_id],
                    "toEdgeId": to_item["edge"]["id"],
                    "type": restriction_type,
                    "restriction": restriction_value
                })
                relation_added = True
        if not relation_added:
            unsupported_restrictions += 1

    graph = {
        "formatVersion": FORMAT_VERSION,
        "regionId": region_id,
        "graphVersion": graph_version,
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "OSM",
        "sourceFormat": "OSM XML",
        "boundingBox": {
            "minLat": bbox["minLat"], "minLon": bbox["minLon"],
            "maxLat": bbox["maxLat"], "maxLon": bbox["maxLon"]
        },
        "nodes": compact_nodes,
        "edges": compact_edges,
        "turnRestrictions": restrictions,
        "nodeCount": len(compact_nodes),
        "edgeCount": len(compact_edges),
        "restrictionCount": len(restrictions)
    }
    stats = {
        "nodeCount": len(compact_nodes),
        "edgeCount": len(compact_edges),
        "restrictionCount": len(restrictions),
        "unsupportedRestrictionCount": unsupported_restrictions,
        "ignoredBusExceptionCount": ignored_bus_exceptions,
        "unsupportedOnewayWayCount": unsupported_oneway_count,
        "unsupportedConditionalAccessWayCount": unsupported_conditional_access_count,
        "inputWayCount": len(ways),
        "includedWayCount": len(way_edges)
    }
    validate_graph(graph, bbox, edge_lookup)
    return graph, stats


def validate_graph(graph: dict[str, Any], bbox: dict[str, float], source_edges: dict[str, dict[str, Any]]) -> None:
    if not all(math.isfinite(bbox.get(key, math.nan)) for key in ("minLat", "minLon", "maxLat", "maxLon")) or not (
        -90 <= bbox["minLat"] < bbox["maxLat"] <= 90 and
        -180 <= bbox["minLon"] < bbox["maxLon"] <= 180
    ):
        raise ValueError("BoundingBox ist unplausibel.")
    node_ids = {node["id"] for node in graph["nodes"]}
    edge_ids = {edge["id"] for edge in graph["edges"]}
    edges_by_id = {edge["id"]: edge for edge in graph["edges"]}
    if graph["nodeCount"] != len(node_ids) or graph["edgeCount"] != len(edge_ids):
        raise ValueError("Node-/Edge-Zähler stimmen nicht mit dem Graphen überein.")
    if not node_ids or not edge_ids:
        raise ValueError("BBox enthält keinen routingfähigen Graphen.")
    if graph["restrictionCount"] != len(graph["turnRestrictions"]):
        raise ValueError("Restriction-Zähler stimmt nicht.")
    for node in graph["nodes"]:
        if not all(math.isfinite(node[key]) for key in ("lat", "lon")) or not in_bbox((node["lat"], node["lon"]), bbox):
            raise ValueError("Graph enthält ungültige oder außerhalb der BBox liegende Nodes.")
    for edge in graph["edges"]:
        if edge["from"] not in node_ids or edge["to"] not in node_ids:
            raise ValueError(f"Kante {edge['id']} verweist auf einen fehlenden Node.")
        if not math.isfinite(edge["lengthMeters"]) or edge["lengthMeters"] <= 0:
            raise ValueError(f"Kante {edge['id']} hat eine ungültige Länge.")
        if edge["oneway"] is not True:
            raise ValueError(f"Kante {edge['id']} ist nicht eindeutig gerichtet.")
        source = source_edges[edge["id"]]
        highway = source["roadClass"]
        if highway in SPECIAL_CLASSES and source["bus"] not in EXPLICIT_ALLOW:
            raise ValueError(f"Unzulässiger Sonderweg {edge['id']} wurde aufgenommen.")
    for restriction in graph["turnRestrictions"]:
        from_edge = edges_by_id.get(restriction["fromEdgeId"])
        to_edge = edges_by_id.get(restriction["toEdgeId"])
        if not from_edge or not to_edge or from_edge["to"] != restriction["viaNodeId"] or to_edge["from"] != restriction["viaNodeId"]:
            raise ValueError("Turn-Restriction verweist nicht auf passende Kanten und Via-Node.")
    json.dumps(graph, allow_nan=False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Erzeugt einen lokalen LocalBusRouter-Graphen aus einer OSM-XML-Datei.")
    parser.add_argument("--input", required=True, type=Path, help="Lokale .osm/.xml-Datei; PBF vorher lokal in OSM-XML umwandeln.")
    parser.add_argument("--output", required=True, type=Path, help="Zieldatei, z. B. region-routing-graph.json")
    parser.add_argument("--region-id", required=True, help="Stabile Kennung des begrenzten Gebiets")
    parser.add_argument("--graph-version", default="1", help="Version dieser Regionsausgabe (Standard: 1)")
    parser.add_argument("--bbox", required=True, type=parse_bbox, help="west,south,east,north, z. B. 14.10,51.60,14.65,51.90")
    args = parser.parse_args(argv)
    if args.input.suffix.lower() not in {".osm", ".xml"}:
        parser.error("Eingabe muss OSM-XML sein; PBF bitte lokal mit 'osmium cat input.osm.pbf -o input.osm' umwandeln.")
    try:
        graph, stats = build_graph(args.input, args.bbox, args.region_id, args.graph_version)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(graph, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print(
        f"OSM-Graph {graph['regionId']}: {stats['nodeCount']} Nodes, "
        f"{stats['edgeCount']} gerichtete Edges, {stats['restrictionCount']} Turn-Restrictions "
        f"({stats['unsupportedRestrictionCount']} Restriktionen und "
        f"{stats['unsupportedOnewayWayCount'] + stats['unsupportedConditionalAccessWayCount']} Wege nicht unterstützt)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
