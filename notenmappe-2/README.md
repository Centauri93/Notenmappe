# Notenmappe 2

Abgespeckte zweite Version der Notenmappe: **nur mündliche Noten** – Sitzplan,
Noteneingabe per Antippen, Bemerkungen, Durchschnitte, PDF-Ausdruck und
Datensicherung. Klassenarbeiten und Notenbesprechungen aus der ersten Version
gibt es hier nicht mehr.

**Alle Daten bleiben auf dem Gerät.** Kein Server, kein Login, keine Cloud,
keine externen Bibliotheken. Die App funktioniert vollständig offline.

Gedacht für den Betrieb auf **einem** Gerät (iPad). Mac und iPhone können die
App ebenfalls öffnen, haben aber jeweils einen eigenen Datenstand – abgeglichen
wird ausschließlich über die Sicherungsdatei (siehe unten).

## Auf dem iPad installieren

Safari installiert eine Web-App nur, wenn sie über **https** ausgeliefert wird.
Deshalb liegt der Code (nur der Code – keine Schülerdaten) auf GitHub Pages:

1. In Safari die Adresse der App öffnen.
2. *Teilen* → **„Zum Home-Bildschirm“** → *Hinzufügen*.
3. Ab jetzt über das Symbol auf dem Home-Bildschirm starten – die App läuft
   dann offline, die Daten bleiben im Speicher dieser installierten App.

Wichtig: Die Daten gehören zur **installierten** App. Wer dieselbe Adresse
zusätzlich im normalen Safari-Tab öffnet, sieht dort einen anderen (leeren)
Datenstand. Immer über das Home-Bildschirm-Symbol arbeiten.

Nach einer Code-Änderung auf GitHub Pages holt sich die installierte App beim
nächsten Start die neue Version im Hintergrund; der zweite Start zeigt sie.

## Starten auf dem Mac (Entwicklung)

```bash
cd notenmappe-2
python3 serve.py
```

Der Browser öffnet sich auf <http://localhost:8000>. Zum Beenden `Strg+C`.
Node.js oder npm werden nicht gebraucht – die App besteht aus reinem HTML,
CSS und ES-Modulen.

> Beim Entwickeln stört der Offline-Cache. `http://localhost:8000/?nosw=1`
> lädt die App ohne Service Worker. Nach jeder Code-Änderung, die auf das iPad
> soll, in `sw.js` die Konstante `CACHE` hochzählen.

## Bedienung

| Ansicht | Was man dort tut |
| --- | --- |
| **Klassen** | Klassen anlegen, umbenennen, löschen |
| **Schüler:innen** | Namen und Fotos pflegen (Datei oder Kamera), ganze Klasse per Foto-Import anlegen |
| **Sitzplan** | Karten frei verschieben, antippen zum Benoten, Stunde beenden |
| **Noten** | Tabelle aller Stunden, Zeitraumfilter, Durchschnitte, PDF |
| **Einstellungen** | Passwortschutz, Sicherung exportieren/importieren, Daten löschen |

### Stundenablauf

1. Klasse öffnen → Sitzplan erscheint mit der zuletzt gespeicherten Anordnung.
2. Auf eine Karte tippen → Note 1–6, „fehlt“, Mehrfachwertung und Bemerkung
   stehen zur Wahl. Die Karte aktualisiert sich sofort.
3. Am Ende **„Stunde beenden“** – alle Einträge wandern fest in die Historie,
   die Karten werden wieder neutral, die Sitzordnung bleibt.

Der erste Eintrag einer Stunde legt die Stunde automatisch an. Eine Stunde
ohne Einträge wird beim Beenden verworfen.

Rechts unten auf jeder Karte steht der **gewichtete Durchschnitt der letzten
6 Monate**. Die farbige Marke oben rechts zeigt die Note **dieser** Stunde.

### Der Eintrag bleibt bis zum Stundenende änderbar

Pro Schüler:in und Stunde gibt es **einen** Eintrag. Alles wird sofort
gespeichert – auch eine Bemerkung allein. Dieselbe Note noch einmal antippen
nimmt sie zurück. Mit **„Stunde beenden“** wird der Stand festgeschrieben;
abgeschlossene Stunden sind unveränderlich.

### Fehlt

**„🚫 Fehlt“** vermerkt Abwesenheit. Solche Einträge erscheinen in Tabelle
und PDF als `fehlt`, zählen aber **nicht** in den Durchschnitt.

### Mehrfachwertung

**×2 / ×3 / ×5** lassen die Note dieser einen Stunde entsprechend oft zählen –
für Referate, Präsentationen oder Projekte. Antippen der aktiven Stufe nimmt
sie zurück. Beispiel: Note 1 (dreifach) und Note 4 ergeben (1·3 + 4) / 4 =
**1,75**.

### Klasse per Foto-Import anlegen

Unter *Schüler:innen → „📁 Fotos importieren“* beliebig viele Bilder auswählen.
Für jedes Foto entsteht ein:e Schüler:in; der Name kommt aus dem Dateinamen
(`MUELLER_Anna.jpg` → Anna Mueller, `Müller, Anna.jpg` → Anna Müller,
`01_Berger_Tom.jpg` → Tom Berger). Bereits vorhandene Namen werden
übersprungen; Kamera-Dateinamen wie `IMG_1234.jpg` werden übergangen.

### PDF

**„⎙ PDF Klasse“** (oder „PDF“ in einer Zeile der Notentabelle) öffnet eine
Druckvorschau. Im Druckdialog **„PDF“ → „Als PDF sichern“** wählen. Pro
Schüler:in entsteht ein Blatt mit allen Einzelnoten, Bemerkungen und der
errechneten mündlichen Note.

## Sicherung

*Einstellungen → Sicherung exportieren* erzeugt `noten-sicherung-JJJJ-MM-TT.zip`
(bzw. `.notenbackup`, wenn der Passwortschutz aktiv ist). Auf dem iPad landet
die Datei in *Dateien → Downloads*; von dort per AirDrop, iCloud Drive oder
Mail wegsichern. **Regelmäßig sichern** – wird der Speicher der App gelöscht,
sind die Noten weg.

*Sicherung importieren* bietet **Ersetzen** (überschreibt alles) oder
**Zusammenführen** (ergänzt).

Sicherungen der **ersten Notenmappe** lassen sich hier einlesen: Klassen,
Schüler:innen, Fotos, Stunden und mündliche Noten werden übernommen,
Klassenarbeiten und Notenbesprechungen stillschweigend übersprungen.

## Passwortschutz

Optional unter *Einstellungen*. Namen, Fotos, Noten und Bemerkungen werden
dann verschlüsselt (PBKDF2 → AES-GCM) gespeichert, auch in der
Sicherungsdatei. Es gibt keine Passwort-Wiederherstellung.

## Aufbau

```
index.html               App-Shell
manifest.webmanifest     PWA-Manifest
sw.js                    Service Worker (Offline-Cache der App-Dateien)
serve.py                 Lokaler Entwicklungsserver
css/app.css              Styles inkl. Druck-Layout
icons/                   App-Icons (192/512)
js/
  db.js                  IndexedDB-Wrapper
  store.js               Fachlogik: Klassen, Schüler, Stunden, Noten
  security.js            Passwortschutz und Verschlüsselung
  backup.js              Export/Import der Sicherungsdatei
  zip.js                 ZIP schreiben/lesen (ohne Bibliothek)
  photo.js               Fotos zuschneiden und verkleinern
  names.js               Namen aus Dateinamen ableiten (Foto-Import)
  seatlayout.js          Anordnung der Karten auf der Sitzfläche
  dnd.js                 Drag & Drop über Pointer-Events (Touch + Maus)
  ui.js                  DOM-Helfer, Modal, Toast, Formatierung
  app.js                 Hash-Router
  views/                 Klassen, Schüler:innen, Sitzplan, Noten, Bericht, Einstellungen, Sperre
```

### Datenmodell (IndexedDB, Datenbank `notenmappe-2`)

| Store | Inhalt |
| --- | --- |
| `classes` | `{ id, name, seating: { [studentId]: {x, y} }, cardScale, createdAt }` |
| `students` | `{ id, classId, firstName, lastName, photo: Blob, createdAt }` |
| `sessions` | `{ id, classId, startedAt, closedAt }` – `closedAt: null` = laufend |
| `grades` | `{ id, sessionId, classId, studentId, value, comment, absent, weight, createdAt }` |
| `meta` | Einstellungen (z.B. Passwortschutz) |

`value: null` = Eintrag ohne Note, `absent: true` = fehlt, `weight: 2|3|5` =
zählt entsprechend oft (sonst 1). Sitzplatz-Positionen sind Bruchteile von
0–1 der Sitzfläche.

Die Datenbank heißt bewusst anders als die der ersten Version (`noten-app`),
damit beide Apps im selben Browser nebeneinander laufen können.
