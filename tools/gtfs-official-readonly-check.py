"""Read-only DELFI/Cottbus comparison against a staging variant index."""
import csv
import io
import json
import sqlite3
import sys
import zipfile


def rows(archive, name):
    infos = [item for item in archive.infolist() if item.filename == name]
    if len(infos) != 1 or infos[0].file_size > 3_000_000_000:
        raise ValueError(f"GTFS table missing, ambiguous or too large: {name}")
    with archive.open(infos[0]) as stream:
        yield from csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig", newline=""))


def identity(agencies):
    matches = [item for item in agencies if item.get("agency_name", "").strip().casefold() == "cottbusverkehr"]
    if len(matches) != 1 or not matches[0].get("agency_id", "").strip():
        raise ValueError("Cottbusverkehr is missing or ambiguous")
    return matches[0]["agency_id"].strip()


def route_key(name, route_type):
    if not name.strip():
        raise ValueError("Route without short name")
    return (name.strip().casefold(), route_type)


def main(index_path, zip_path):
    uri = "file:" + index_path.replace("\\", "/") + "?mode=ro&immutable=1"
    db = sqlite3.connect(uri, uri=True)
    try:
        agencies = [dict(zip(("agency_id", "agency_name"), row)) for row in db.execute("SELECT agency_id, agency_name FROM agencies")]
        old_id = identity(agencies)
        meta = dict(db.execute("SELECT key, value FROM meta"))
        if json.loads(meta["agency_ids"]) != [old_id]:
            raise ValueError("Staging index is not operator-isolated")
        old = {}
        for route_id, agency_id, name, route_type in db.execute("SELECT route_id, agency_id, short_name, route_type FROM routes"):
            if agency_id != old_id:
                raise ValueError("Foreign route in staging index")
            key = route_key(name, route_type)
            if key in old:
                raise ValueError("Ambiguous staging line")
            old[key] = (route_id, set())
        by_id = {route_id: key for key, (route_id, _) in old.items()}
        for route_id, direction, stops_json in db.execute("SELECT route_id, direction_id, stops_json FROM variants"):
            old[by_id[route_id]][1].add((direction or "", tuple(item["stopId"] for item in json.loads(stops_json))))
    finally:
        db.close()

    with zipfile.ZipFile(zip_path) as archive:
        new_id = identity(list(rows(archive, "agency.txt")))
        new = {}
        for row in rows(archive, "routes.txt"):
            if row.get("agency_id") != new_id:
                continue
            key = route_key(row.get("route_short_name", ""), row.get("route_type", ""))
            if key in new:
                raise ValueError("Ambiguous official line")
            new[key] = (row["route_id"], set())
        by_id = {route_id: key for key, (route_id, _) in new.items()}
        trips = {}
        for row in rows(archive, "trips.txt"):
            route_id = row.get("route_id", "")
            if route_id in by_id:
                trips[row["trip_id"]] = (by_id[route_id], row.get("direction_id", ""))
        sequences = {}
        for row in rows(archive, "stop_times.txt"):
            trip_id = row.get("trip_id", "")
            if trip_id in trips:
                sequences.setdefault(trip_id, []).append((int(row["stop_sequence"]), row["stop_id"]))
        for trip_id, stops in sequences.items():
            key, direction = trips[trip_id]
            ordered = tuple(stop_id for _, stop_id in sorted(stops))
            if len(ordered) >= 2:
                new[key][1].add((direction, ordered))
        line16_key = [key for key in new if key[0] == "16"]
        if len(line16_key) != 1 or line16_key[0] not in old:
            raise ValueError("Line 16 cannot be uniquely compared")
        line16_changed = old[line16_key[0]][1] != new[line16_key[0]][1]
        line16_route_id = new[line16_key[0]][0]
        line16_trip_ids = {trip for trip, (key, _) in trips.items() if key == line16_key[0]}
        names = {row["stop_id"]: row.get("stop_name", "") for row in rows(archive, "stops.txt")}
        ends_uhland = any(names.get(seq[-1][1], "").casefold().endswith("uhlandstraße")
                           for trip, seq in sequences.items() if trip in line16_trip_ids and seq)
        changed_lines = sum(old[key][1] != value[1] for key, value in new.items() if key in old)
        print(json.dumps({"oldAgencyId": old_id, "newAgencyId": new_id,
                          "oldLines": len(old), "newLines": len(new),
                          "changedLines": changed_lines, "line16RouteId": line16_route_id,
                          "line16Changed": line16_changed, "line16EndsUhlandstrasse": ends_uhland},
                         ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: gtfs-official-readonly-check.py STAGING_INDEX OFFICIAL_ZIP")
    main(sys.argv[1], sys.argv[2])
