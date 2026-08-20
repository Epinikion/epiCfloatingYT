<img src="build/icon.png" width="96" align="left" alt="FloatingYT" />

# FloatingYT

Ein rahmenloser, immer im Vordergrund bleibender YouTube-Player für Windows –
mit schneller integrierter Videosuche, lokalen Dateien und Ordnern, Ambient Light,
eigener kompakter Bedienung, Playlist-Unterstützung und mehrstufiger Werbefilterung.

Diese Codebasis ist eine vollständige Neuimplementierung. Sie bildet die
bewährte Oberfläche der Vorgängerversion nach, trennt aber Fensterverwaltung,
Medienauflösung, lokalen Player-Host, YouTube-Integration und Renderer klar
voneinander. Der frühere, nicht ausgelieferte Rust/WebView2-Prototyp ist daher
nicht mehr enthalten.

<br clear="left" />

## Start und Build

```powershell
npm install
npm start
```

Ein Link kann direkt beim Start übergeben werden:

```powershell
npm start -- "https://www.youtube.com/watch?v=U9NEoHrkldM"
```

Prüfen und bauen:

```powershell
npm run check
npm run dist
```

Die Artefakte heißen `dist/FloatingYT.exe` (portabel) und
`dist/FloatingYT-Setup-2.0.0.exe` (Installer).

## Bedienung

- Suchbegriff in das Startfeld eingeben und ein Ergebnis mit Maus oder Pfeiltasten/Enter öffnen.
- YouTube-Links werden im selben Feld automatisch erkannt und direkt geladen.
- Eine Videodatei oder einen ganzen Ordner auf das Fenster ziehen, um ihn lokal abzuspielen.
- Die Leiste am oberen Videorand erscheint beim Darüberfahren.
- Freie Fläche in Leiste oder Video verschiebt das Fenster.
- Ein einfacher Klick auf die Videofläche verändert die Wiedergabe nicht.
- Doppelklick auf freie Videofläche schaltet Vollbild.
- Play/Pause, aktuelle Zeit, Dauer und Zeitleiste bleiben im Video; Lautstärke, Qualität, Tempo und
  Untertitel liegen im Zahnrad-Menü.
- Untertitel sind zunächst aus; danach wird die zuletzt gewählte Sprache oder „Aus“ gespeichert.
- Querformat, Shorts und andere Videoformate passen das Fenster automatisch an.
- Bei aktivem Randlicht sitzen die Resize-Griffe direkt an der Videokante.
- Der transparente Randlichtbereich ist klickdurchlässig für darunterliegende Fenster.

| Kürzel | Wirkung |
| --- | --- |
| `Strg+V` | YouTube-Link aus der Zwischenablage laden |
| `Strg+F` / `Strg+L` | Videosuche öffnen |
| `Leertaste` / `K` | Play/Pause |
| `M` | Ton an/aus |
| `↑` / `↓` | Lautstärke in 5-%-Schritten ändern |
| `Strg+←` / `Strg+→` | Vorheriges / nächstes Video |
| `Strg+Umschalt+P` | Playlist anzeigen/schließen |
| `Strg+P` | Immer im Vordergrund an/aus |
| `Strg+,` | Einstellungsmenü |
| `Strg+B` | Ambient Light an/aus |
| `Strg+U` | Schärfung an/aus |
| `Strg+↑` / `Strg+↓` | Deckkraft ändern |
| `Strg+Umschalt+A` | Seitenverhältnis fixieren/freigeben |
| `Strg+W` | Schließen |

Fensterposition, Videogröße, Deckkraft und Einstellungen werden gespeichert.
Ein vorhandener Zustand der bisherigen Electron-Version wird beim ersten Start
automatisch in das neue Format übernommen.

## Lokale Videos

Einzelne Dateien und Ordner lassen sich per Drag-and-drop auf jede Stelle des
Fensters ziehen. Ordner werden rekursiv durchsucht; gefundene Videos landen in
einer natürlich sortierten Warteschlange und spielen automatisch nacheinander.
Mit `Strg+←` und `Strg+→` kann darin vor- und zurückgesprungen werden. Das
Playlist-Symbol oder `Strg+Umschalt+P` öffnet die Liste zur direkten Auswahl;
dieselbe Ansicht steht auch für YouTube-Playlists bereit.

Erkannt werden MP4, M4V, WebM, OGV/OGG, MOV, MKV, AVI und WMV. Welche dieser
Dateien tatsächlich abspielbar sind, hängt zusätzlich vom enthaltenen Video-
und Audio-Codec ab; MP4 mit H.264/AAC und WebM sind die zuverlässigsten Formate.
Nicht unterstützte Dateien zeigen eine verständliche Fehlermeldung im Player.

Die App gibt lokale Dateipfade nicht an die Oberfläche oder an Webseiten weiter.
Sie überträgt die ausgewählten Videos ausschließlich über zufällige, kurzlebige
Adressen des internen Players und unterstützt dabei auch bytegenaues Seeking.

## Gesperrte Videos und persönliche Listen

Wenn YouTube einen Embed mit Fehler 100, 101 oder 150 ablehnt, versucht die App
keinen separaten Direktstrom mehr. FloatingYT wechselt sofort auf die normale,
auf den Player reduzierte YouTube-Seite. Dadurch gibt es weder eine zusätzliche
Wartezeit noch einen später abbrechenden Audio-/Videostream.

Persönliche Listen wie „Mein Mix“, „Später ansehen“ und „Gefällt mir“ werden
weiterhin mit `yt-dlp` aufgelöst. Dafür muss `yt-dlp` im Suchpfad liegen:

```powershell
winget install yt-dlp.yt-dlp
```

Diese Listen brauchen außerdem die YouTube-Anmeldung eines echten Browsers. Der
Browser kann im Zahnrad-Menü unter **Playlist-Login** gewählt werden. FloatingYT
liest die Cookies nicht selbst; der Browsername wird ausschließlich an die
eingebaute `yt-dlp --cookies-from-browser`-Funktion übergeben. Firefox funktioniert meist
auch im laufenden Betrieb, Chromium-Browser können ihre Cookie-Datenbank sperren.

## Architektur

| Bereich | Aufgabe |
| --- | --- |
| `src/main/` | App-Lebenszyklus, Fenster, Zustand, lokaler Player-Server und Listenauflösung |
| `src/preload/` | kleine, explizite IPC-Brücke für die vertrauenswürdige Oberfläche |
| `src/guest/` | schmale Electron-Brücke für den jeweiligen Webview-Hauptframe |
| `src/extension/` | auf YouTube begrenzte Content-Scripts für Unterframes, CSS und Ad-Filter |
| `src/player/` | lokale Player für YouTube-Embeds und Dateien von der Festplatte |
| `src/renderer/` | Oberfläche, Playback-Zustandsmaschine und Ambient-Renderer |
| `src/shared/` | gemeinsam genutztes, getestetes YouTube-Linkmodell |
| `test/` | URL-, Geometrie-, Zustands-, Medien- und Sicherheitsregressionen |

Die Videosuche liest die öffentliche YouTube-Ergebnisseite ohne API-Key, begrenzt
Antwortgröße und Laufzeit und gibt ausschließlich validierte Video-Metadaten an
die Oberfläche weiter. Kurze Caches und zusammengefasste parallele Anfragen halten
die Suche responsiv, ohne unnötige Netzwerkzugriffe.

Die Wiedergabepfade senden Ereignisse für Titel, Format, Fehler und Ende. Der
Renderer muss den Gast dadurch nicht fortlaufend mit `executeJavaScript`
abfragen. Navigationsziele, IPC-Kommandos, Listen-IDs und Video-IDs werden an
den jeweiligen Vertrauensgrenzen validiert.

Fremde YouTube-Iframes erhalten ausdrücklich keine Node-Integration. Eine nur
für YouTube-Domains geladene Content-Extension übernimmt dort Styles, Gesten
und Statusmeldungen; Electron-IPC bleibt auf den Webview-Hauptframe begrenzt.

## Ambient Light und Werbefilter

Das gerenderte Playerbild wird im Hauptprozess auf 80×45 Pixel verkleinert.
Der Renderer erhält Letterbox-/Pillarbox-Ränder, damit schwarze Bildbereiche kein
falsches Randlicht erzeugen, glättet Bildwechsel zeitlich und zeichnet nur die
kleine Farbquelle weich hinter die Videofläche.
Bei deaktiviertem Randlicht, Vollbild oder minimiertem Fenster pausiert die
Erfassung.

Werbung wird auf drei Ebenen behandelt:

1. konservative Netzwerkregeln für bekannte Ad- und Tracking-Endpunkte,
2. frühe Bereinigung von Anzeigenfeldern in YouTube-Playerantworten,
3. DOM-seitiges Überspringen, Schließen oder lautloses Vorspulen verbleibender Ads.

Die Cookie-Abfrage wird automatisch mit „Alle ablehnen“ beantwortet.
