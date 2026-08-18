<img src="build/icon.png" width="96" align="left" alt="FloatingYT" />

# FloatingYT

Ein rahmenloser, immer im Vordergrund bleibender YouTube-Player für Windows –
mit Ambient Light, eigener kompakter Bedienung, Playlist-Unterstützung und
mehrstufiger Werbefilterung.

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

- Link in das Startfeld einfügen und Enter drücken.
- Die Leiste am oberen Videorand erscheint beim Darüberfahren.
- Freie Fläche in Leiste oder Video verschiebt das Fenster.
- Doppelklick auf freie Videofläche schaltet Vollbild.
- Play/Pause und Zeitleiste bleiben im Video; Lautstärke, Qualität, Tempo und
  Untertitel liegen im Zahnrad-Menü.
- Querformat, Shorts und andere Videoformate passen das Fenster automatisch an.
- Bei aktivem Randlicht sitzen die Resize-Griffe direkt an der Videokante.

| Kürzel | Wirkung |
| --- | --- |
| `Strg+V` | YouTube-Link aus der Zwischenablage laden |
| `Leertaste` / `K` | Play/Pause |
| `M` | Ton an/aus |
| `Strg+←` / `Strg+→` | Vorheriges / nächstes Video |
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

## Gesperrte Videos und persönliche Listen

Wenn YouTube einen Embed mit Fehler 100, 101 oder 150 ablehnt, versucht die App
zuerst einen Direktstrom. Dafür muss `yt-dlp` im Suchpfad liegen:

```powershell
winget install yt-dlp.yt-dlp
```

Bild und Ton werden bei getrennten YouTube-Spuren synchron wiedergegeben. Die
echten Medienadressen verlassen den Hauptprozess nicht; kurzlebige, zufällige
lokale Tokens trennen die einzelnen Medien-Sessions. Scheitert ein Direktstrom,
wechselt FloatingYT kontrolliert auf die normale, auf den Player reduzierte
YouTube-Seite. Ohne `yt-dlp` werden gesperrte Playlist-Titel übersprungen oder
ebenfalls auf der Watch-Seite geöffnet.

Persönliche Listen wie „Mein Mix“, „Später ansehen“ und „Gefällt mir“ brauchen
die YouTube-Anmeldung eines echten Browsers. Der Browser kann im Zahnrad-Menü
unter **Playlist-Login** gewählt werden. FloatingYT liest die Cookies nicht
selbst; der Browsername wird ausschließlich an die eingebaute
`yt-dlp --cookies-from-browser`-Funktion übergeben. Firefox funktioniert meist
auch im laufenden Betrieb, Chromium-Browser können ihre Cookie-Datenbank sperren.

## Architektur

| Bereich | Aufgabe |
| --- | --- |
| `src/main/` | App-Lebenszyklus, Fenster, Zustand, lokaler Server, Medienauflösung |
| `src/preload/` | kleine, explizite IPC-Brücke für die vertrauenswürdige Oberfläche |
| `src/guest/` | schmale Electron-Brücke für den jeweiligen Webview-Hauptframe |
| `src/extension/` | auf YouTube begrenzte Content-Scripts für Unterframes, CSS und Ad-Filter |
| `src/player/` | lokaler IFrame-API-Player und Direktstrom-Player |
| `src/renderer/` | Oberfläche, Playback-Zustandsmaschine und Ambient-Renderer |
| `src/shared/` | gemeinsam genutztes, getestetes YouTube-Linkmodell |
| `test/` | URL-, Geometrie-, Zustands-, Medien- und Sicherheitsregressionen |

Die Wiedergabepfade senden Ereignisse für Titel, Format, Fehler und Ende. Der
Renderer muss den Gast dadurch nicht fortlaufend mit `executeJavaScript`
abfragen. Navigationsziele, IPC-Kommandos, Listen-IDs und Video-IDs werden an
den jeweiligen Vertrauensgrenzen validiert.

Fremde YouTube-Iframes erhalten ausdrücklich keine Node-Integration. Eine nur
für YouTube-Domains geladene Content-Extension übernimmt dort Styles, Gesten
und Statusmeldungen; Electron-IPC bleibt auf den Webview-Hauptframe begrenzt.

## Ambient Light und Werbefilter

Das gerenderte Playerbild wird im Hauptprozess auf 80×45 Pixel verkleinert.
Der Renderer erkennt stabile Letterbox-/Pillarbox-Ränder, glättet Bildwechsel
zeitlich und zeichnet nur die kleine Farbquelle weich hinter die Videofläche.
Bei deaktiviertem Randlicht, Vollbild oder minimiertem Fenster pausiert die
Erfassung.

Werbung wird auf drei Ebenen behandelt:

1. konservative Netzwerkregeln für bekannte Ad- und Tracking-Endpunkte,
2. frühe Bereinigung von Anzeigenfeldern in YouTube-Playerantworten,
3. DOM-seitiges Überspringen, Schließen oder lautloses Vorspulen verbleibender Ads.

Die Cookie-Abfrage wird automatisch mit „Alle ablehnen“ beantwortet.
