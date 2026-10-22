"""Fixture-only checks for the official-feed tenant extraction."""
import importlib.util
import pathlib
import tempfile
import zipfile


script = pathlib.Path(__file__).with_name("gtfs-official-candidate-filter.py")
spec = importlib.util.spec_from_file_location("candidate_filter", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


with tempfile.TemporaryDirectory(prefix="lehrfahrer-candidate-filter-") as temporary:
    root = pathlib.Path(temporary)
    archive_path = root / "official.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("agency.txt", "agency_id,agency_name\n287,Cottbusverkehr\n143,Fremdbetrieb\n")
        archive.writestr("routes.txt", "route_id,agency_id,route_short_name,route_type\nr16,287,16,3\nother,143,99,3\n")
        archive.writestr("trips.txt", "route_id,service_id,trip_id\nr16,s,t16\nother,s,foreign\n")
        archive.writestr("stop_times.txt", "trip_id,stop_id,stop_sequence\nt16,a,1\nt16,u,2\nforeign,f,1\n")
        archive.writestr("stops.txt", "stop_id,stop_name\na,Start\nu,Uhlandstrasse\nf,Fremd\n")
    output = root / "filtered"
    module.build(archive_path, output)
    assert "Fremdbetrieb" not in (output / "agency.txt").read_text()
    assert "foreign" not in (output / "trips.txt").read_text()
    assert "f,Fremd" not in (output / "stops.txt").read_text()
    assert "Uhlandstrasse" in (output / "stops.txt").read_text()
    print("OK candidate filter isolates Cottbusverkehr")
