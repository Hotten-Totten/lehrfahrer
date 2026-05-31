import json
import math
import re
from pathlib import Path

import requests

OUTPUT_DIR = Path("data")
OUTPUT_DIR.mkdir(exist_ok=True)

OUTPUT_FILE = OUTPUT_DIR / "haltestellen.js"
CENTER_LAT = 51.7563
CENTER_LON = 14.3329
RADIUS_KM = 50
RADIUS_METERS = RADIUS_KM * 1000

OVERPASS_URLS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

CENTER_LAT = 51.7563
CENTER_LON = 14.3329
RADIUS_KM = 50
RADIUS_METERS = RADIUS_KM * 1000

OVERPASS_QUERY = f"""
[out:json][timeout:180];

(
  node["highway"="bus_stop"](around:{RADIUS_METERS},{CENTER_LAT},{CENTER_LON});
  node["railway"="tram_stop"](around:{RADIUS_METERS},{CENTER_LAT},{CENTER_LON});
  node["public_transport"="platform"](around:{RADIUS_METERS},{CENTER_LAT},{CENTER_LON});
  node["public_transport"="stop_position"](around:{RADIUS_METERS},{CENTER_LAT},{CENTER_LON});

  way["highway"="bus_stop"](around:{RADIUS_METERS},{CENTER_LAT},{CENTER_LON});
  way["railway"="tram_stop"](around:{RADIUS_METERS},{CENTER_LAT},{CENTER_LON});
  way["public_transport"="platform"](around:{RADIUS_METERS},{CENTER_LAT},{CENTER_LON});
  way["public_transport"="stop_position"](around:{RADIUS_METERS},{CENTER_LAT},{CENTER_LON});
);

out center tags;
"""


def normalize_name(name: str) -> str:
    name = name.strip()
    name = re.sub(r"\s+", " ", name)
    return name


def distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def extract_lat_lon(element: dict) -> tuple[float | None, float | None]:
    if "lat" in element and "lon" in element:
        return element["lat"], element["lon"]

    center = element.get("center")
    if center and "lat" in center and "lon" in center:
        return center["lat"], center["lon"]

    return None, None


def classify_stop(tags: dict) -> str:
    if tags.get("railway") == "tram_stop":
        return "tram"

    bus_yes = tags.get("bus")
    tram_yes = tags.get("tram")

    if bus_yes == "yes" and tram_yes == "yes":
        return "bus_tram"
    if tram_yes == "yes":
        return "tram"
    if bus_yes == "yes":
        return "bus"

    highway = tags.get("highway")
    railway = tags.get("railway")
    public_transport = tags.get("public_transport")

    if railway == "tram_stop":
        return "tram"
    if highway == "bus_stop":
        return "bus"
    if public_transport in {"platform", "stop_position"}:
        return "mixed"

    return "unknown"


def fetch_stops() -> list[dict]:
    print("Lade Haltestellen von Overpass ...")

    last_error = None

    for overpass_url in OVERPASS_URLS:
        print(f"Versuche Server: {overpass_url}")

        try:
            response = requests.post(
                overpass_url,
                data=OVERPASS_QUERY.encode("utf-8"),
                timeout=180,
                headers={
                    "User-Agent": "bus-linienkunde-importer/1.0"
                },
            )

            response.raise_for_status()

            content_type = response.headers.get("content-type", "").lower()
            if "json" not in content_type and not response.text.strip().startswith("{"):
                preview = response.text[:300].strip()
                raise ValueError(
                    f"Server liefert kein JSON. Content-Type: {content_type or 'unbekannt'} | Antwort: {preview}"
                )

            data = response.json()
            elements = data.get("elements", [])

            raw_stops = []

            for el in elements:
                tags = el.get("tags", {})
                name = tags.get("name", "").strip()
                if not name:
                    continue

                lat, lon = extract_lat_lon(el)
                if lat is None or lon is None:
                    continue

                stop_type = classify_stop(tags)

                raw_stops.append(
                    {
                        "osm_id": f'{el.get("type", "x")}_{el.get("id", "0")}',
                        "name": normalize_name(name),
                        "lat": lat,
                        "lon": lon,
                        "type": stop_type,
                        "tags": tags,
                    }
                )

            print(f"Rohdaten: {len(raw_stops)} Haltestellen")
            return raw_stops

        except Exception as e:
            print(f"Fehler bei {overpass_url}: {e}")
            last_error = e

    raise RuntimeError(f"Alle Overpass-Server fehlgeschlagen: {last_error}")


def deduplicate_stops(raw_stops: list[dict]) -> list[dict]:
    """
    Grobe Dublettenbereinigung:
    gleicher Name + unter 40 m Abstand => zusammenfassen
    """
    grouped: list[dict] = []

    for stop in raw_stops:
        found = None

        for existing in grouped:
            if existing["name"].lower() != stop["name"].lower():
                continue

            dist = distance_meters(
                existing["lat"], existing["lon"], stop["lat"], stop["lon"]
            )
            if dist <= 40:
                found = existing
                break

        if found is None:
            grouped.append(
                {
                    "name": stop["name"],
                    "lat": stop["lat"],
                    "lon": stop["lon"],
                    "types": {stop["type"]},
                    "sources": [stop["osm_id"]],
                }
            )
        else:
            found["lat"] = (found["lat"] + stop["lat"]) / 2
            found["lon"] = (found["lon"] + stop["lon"]) / 2
            found["types"].add(stop["type"])
            found["sources"].append(stop["osm_id"])

    result = []
    for idx, stop in enumerate(sorted(grouped, key=lambda x: x["name"].lower()), start=1):
        types_sorted = sorted(stop["types"])
        if "bus" in types_sorted and "tram" in types_sorted:
            final_type = "bus_tram"
        elif "bus_tram" in types_sorted:
            final_type = "bus_tram"
        elif "tram" in types_sorted:
            final_type = "tram"
        elif "bus" in types_sorted:
            final_type = "bus"
        elif "mixed" in types_sorted:
            final_type = "mixed"
        else:
            final_type = "unknown"

        result.append(
            {
                "id": f"hst_{idx}",
                "name": stop["name"],
                "lat": round(stop["lat"], 6),
                "lon": round(stop["lon"], 6),
                "type": final_type,
                "sourceCount": len(stop["sources"]),
            }
        )

    print(f"Nach Dublettenbereinigung: {len(result)} Haltestellen")
    return result


def write_js(stops: list[dict]) -> None:
    js_content = "const stopCatalog = " + json.dumps(stops, ensure_ascii=False, indent=2) + ";\n"
    OUTPUT_FILE.write_text(js_content, encoding="utf-8")
    print(f"Datei geschrieben: {OUTPUT_FILE}")


def main() -> None:
    raw_stops = fetch_stops()
    clean_stops = deduplicate_stops(raw_stops)
    write_js(clean_stops)
    print("Fertig.")


if __name__ == "__main__":
    main()