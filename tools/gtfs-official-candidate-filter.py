"""Build the operator-only index input from one already downloaded official ZIP."""
import csv
import io
import json
from pathlib import Path
import sys
import zipfile


TABLES = ("agency.txt", "routes.txt", "trips.txt", "stop_times.txt", "stops.txt")
OPTIONAL = {
    "routes.txt": ("route_long_name", "route_type"),
    "trips.txt": ("direction_id", "trip_headsign"),
    "stops.txt": ("stop_lat", "stop_lon", "parent_station"),
}


def table(archive, name):
    matches = [item for item in archive.infolist() if item.filename == name]
    if len(matches) != 1 or matches[0].file_size > 3_000_000_000:
        raise ValueError(f"GTFS table missing, ambiguous or too large: {name}")
    stream = io.TextIOWrapper(archive.open(matches[0]), encoding="utf-8-sig", newline="")
    return stream, csv.DictReader(stream)


def emit(archive, name, output, predicate):
    stream, reader = table(archive, name)
    try:
        header = list(reader.fieldnames or ())
        if not header:
            raise ValueError(f"GTFS header missing: {name}")
        for field in OPTIONAL.get(name, ()):
            if field not in header:
                header.append(field)
        with (output / name).open("w", encoding="utf-8", newline="") as target:
            writer = csv.DictWriter(target, fieldnames=header, extrasaction="ignore", lineterminator="\n")
            writer.writeheader()
            count = 0
            for row in reader:
                if None in row:
                    raise ValueError(f"Malformed GTFS row in {name}")
                if predicate(row):
                    writer.writerow({key: row.get(key, "") for key in header})
                    count += 1
            return count
    finally:
        stream.close()


def build(zip_path, output):
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    with zipfile.ZipFile(zip_path) as archive:
        stream, reader = table(archive, "agency.txt")
        try:
            matches = [row for row in reader if row.get("agency_name", "").strip().casefold() == "cottbusverkehr"]
        finally:
            stream.close()
        if len(matches) != 1 or not matches[0].get("agency_id", "").strip():
            raise ValueError("Cottbusverkehr missing or ambiguous")
        agency_id = matches[0]["agency_id"].strip()
        emit(archive, "agency.txt", output, lambda row: row.get("agency_id", "").strip() == agency_id)
        routes = set()
        def selected_route(row):
            if row.get("agency_id", "").strip() != agency_id:
                return False
            routes.add(row["route_id"])
            return True
        if emit(archive, "routes.txt", output, selected_route) == 0:
            raise ValueError("Cottbusverkehr has no routes")
        trips = set()
        def selected_trip(row):
            if row.get("route_id", "") not in routes:
                return False
            trips.add(row["trip_id"])
            return True
        emit(archive, "trips.txt", output, selected_trip)
        stops = set()
        def selected_stop_time(row):
            if row.get("trip_id", "") not in trips:
                return False
            stops.add(row["stop_id"])
            return True
        emit(archive, "stop_times.txt", output, selected_stop_time)
        emit(archive, "stops.txt", output, lambda row: row.get("stop_id", "") in stops)
    print(json.dumps({"agencyId": agency_id, "routeIds": len(routes), "tripIds": len(trips), "stopIds": len(stops)}))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: gtfs-official-candidate-filter.py OFFICIAL_ZIP EMPTY_OUTPUT_DIR")
    build(Path(sys.argv[1]), Path(sys.argv[2]))
