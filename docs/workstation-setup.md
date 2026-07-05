# Frank AI Workstation – Setup-Stand

Stand: 05.07.2026

## 1. System

- Windows 11 Pro installiert und aktiviert
- Office 2024 Professional installiert
- Bitwarden installiert
- Firefox als Hauptbrowser
- WLAN und LAN funktionsfähig
- RGB-Beleuchtung deaktiviert

## 2. Hardware / BIOS

- Mainboard: MSI MAG B850 Tomahawk MAX WiFi
- CPU: AMD Ryzen 7 9800X3D
- GPU: NVIDIA GeForce RTX 5080
- RAM: 32 GB DDR5
- EXPO aktiviert: 6000 MT/s
- Primäre Grafik: PEG / RTX 5080
- iGPU deaktiviert
- Boot: Samsung 990 EVO M.2_1

## 3. Laufwerke

- C: System / Windows / Programme
- K: Daten / Projekte
- L: Archiv / Backups / Systemimages
- I/J: alte 256-GB-SSDs, später für Linux / Tests vorgesehen

## 4. Projektstruktur

K:\Projekte

- Lehrfahrer
- MSC-Bot
- VBA
- WordPress
- Sonstige
- _Workspace

L:\Archiv

- Alte PCs
- Archiv
- Backups
- Dokumentation
- Installationen
- ISO
- Software
- Systemimages
- Treiber

## 5. Git

Git installiert: 2.55.0.windows.2

Konfiguration:

- user.name = Frank Fudeus
- user.email = hotten-totten@fuddie.de
- default branch = main
- Git LFS aktiv
- Credential Manager aktiv
- SSH eingerichtet

GitHub SSH-Test erfolgreich:

Hi Hotten-Totten! You've successfully authenticated, but GitHub does not provide shell access.

## 6. Lehrfahrer Repository

Repository:

git@github.com:Hotten-Totten/lehrfahrer.git

Lokaler Pfad:

K:\Projekte\Lehrfahrer

Status:

- Branch: main
- Remote: origin
- Arbeitsbaum sauber
- Letzter Stand: origin/main

Letzter Commit:

e53ab27 Verbesserung Personalverwaltung/ Academy

## 7. VS Code

Installiert und eingerichtet:

- German Language Pack
- GitLens
- PHP Intelephense
- EditorConfig
- Error Lens
- Path Intellisense
- Markdown All in One

Einstellungen:

- Automatisches Speichern aktiv
- Intelephense Max Memory: 8192 MB

Workspace:

K:\Projekte\_Workspace\Lehrfahrer.code-workspace

## 8. XAMPP

Installiert unter:

C:\xampp

Version:

- XAMPP 8.2.12
- Apache 2.4.58
- PHP 8.2.12

Läuft:

- Apache
- MySQL

Lehrfahrer lokal erreichbar:

http://localhost/lehrfahrer/app/

API erreichbar:

http://localhost/lehrfahrer/api/list_lines.php

## 9. App-Status Offline

Der Status "Offline" in der Lehrfahrer-App ist kein Fehler.

Bedeutung:

- Die App kann ohne Internetverbindung genutzt werden.
- GPS-Nutzung ist weiterhin möglich.
- Offlinebetrieb ist Teil des Konzepts.

## 10. Nächste Schritte

- Composer installieren
- Node.js installieren
- ggf. Xdebug vorbereiten
- erstes Systemimage erstellen
- Linux-SSD planen
- Docker / WSL später einrichten