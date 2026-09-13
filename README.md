# Humnote

A Java-powered humming-to-MIDI workspace. Record or upload a melody, correct it in a piano roll, preview the result, and export a standard MIDI file. An optional AI assistant edits notes from natural-language instructions.

## Architecture

This edition migrates the server to **Java 17 and Spring Boot**. Java owns the AI API, authoritative melody validation, and MIDI encoding through `javax.sound.midi`. The React/TypeScript interface remains in the browser because microphone capture, interactive editing, and Spotify Basic Pitch recognition use browser APIs. This is a Java web application, not a Java desktop application or an entirely Java-only codebase.

The production build packages the interface and local recognition model inside one executable JAR. No Node.js server, Cloudflare account, database, or API key is required to record, edit, and export melodies.

```text
Browser: microphone / audio file
  -> Basic Pitch + TensorFlow.js on the device
  -> piano-roll editor and synthesized preview
  -> POST /api/midi -> Java MIDI encoder -> .mid download
  -> POST /api/arrange -> Java -> selected AI provider (optional)
```

## Requirements

- JDK 17 or later. The project compiles to Java 17 bytecode.
- Node.js 22.13 or later to build the interface.
- Maven 3.9.11, or the included Maven wrapper.
- A modern browser. Microphone capture requires `localhost` or HTTPS.

Spring Boot 3.5 supports Java 17 through Java 25; see the [official system requirements](https://docs.spring.io/spring-boot/3.5/system-requirements.html).

## Build and run

From the repository root:

```sh
npm ci --prefix frontend
npm run build --prefix frontend
bash mvnw clean verify
java -jar target/humnote-0.0.1.jar
```

On Windows, use `mvnw.cmd clean verify` instead of `bash mvnw clean verify`.

Open **http://localhost:8080**. The default bind address is `127.0.0.1`. After packaging, only Java is needed to run the JAR. The first build downloads dependencies; the recognition model is already included in the repository.

Build the frontend before packaging Java; otherwise the JAR will contain the API without the editor. GitHub Actions performs both steps in the correct order.

## Development

Run the Java API in one terminal:

```sh
bash mvnw spring-boot:run -Dspring-boot.run.profiles=dev
```

Run the editor in another:

```sh
npm ci --prefix frontend
npm run dev --prefix frontend
```

Open **http://localhost:5173**. Vite proxies `/api` to `127.0.0.1:8080`. The `dev` profile permits the two local Vite origins. If port 5173 is occupied, stop the conflicting server instead of using an unconfigured origin.

## Workflow

1. Record up to 30 seconds of unaccompanied humming, or upload a supported audio file below 30 MB. WAV, MP3, and M4A support depends on the browser decoder.
2. Set BPM yourself. The application does not automatically detect tempo or meter.
3. Preview the transcribed notes and compare them with the original recording.
4. Drag a note to change pitch or start time. Drag its right edge to change duration. The inspector provides exact pitch, velocity, start, and duration controls.
5. Double-click empty space to add a note. Use the grid selector and **Quantize to grid** to align rhythm.
6. Export MIDI to a DAW, or use **Save project** to download editable JSON. Use **Open project** to restore it.

Projects are not automatically saved. Save before refreshing or closing the page. **Try demo** loads an explicitly labeled preset; it is not a transcription result.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Space | Play or stop |
| Delete / Backspace | Delete the selected note |
| Up / Down | Move the selected pitch by one semitone |
| Left / Right | Move the selected note by one grid step |
| Shift + Left / Right | Change duration by one grid step |
| Ctrl / Cmd + Z | Undo |
| Ctrl / Cmd + Shift + Z | Redo |

Focus the piano roll to use editing shortcuts. Changes support undo/redo, including applied AI proposals.

## AI melody editing

Open **Model settings**, choose **OpenAI** or **DeepSeek**, and enter a model ID available to your account plus your own API key. The model must support Chat Completions and JSON-object output. Provider usage may incur charges on your account.

The browser sends notes, BPM, instructions, model ID, and the request-scoped key to the Java API. Java forwards the request only to the fixed provider endpoints in `ArrangeService`. Audio recordings are never sent to the application server or AI provider. The key is not saved to local storage, project JSON, or a database and is not logged by application code. Refreshing clears the browser copy.

The model briefly explains its changes. Proposals are validated, then shown for preview, apply, or discard. Missing credentials do not produce simulated AI responses. Invalid output, denied credentials, quota limits, and timeouts return error messages.

## API

All mutation requests use `Content-Type: application/json`. Bodies are limited to 100,000 bytes. API responses use `Cache-Control: no-store`.

| Method | Endpoint | Request / response |
| --- | --- | --- |
| GET | `/api/health` | `{"status":"ok"}` |
| POST | `/api/melody/validate` | Melody JSON; returns normalized, sorted notes |
| POST | `/api/midi` | `{"melody":{...},"program":0}`; returns a MIDI attachment |
| POST | `/api/arrange` | `{"melody":{...},"instruction":"...","provider":"openai","model":"...","apiKey":"..."}`; returns notes, BPM, and explanation |

Example melody:

```json
{
  "bpm": 100,
  "notes": [
    { "id": "note-0", "pitch": 60, "start": 0, "duration": 1, "velocity": 0.75 }
  ]
}
```

Times are **quarter-note beats**, not seconds. A note at beat 2 starts at 1.2 seconds at 100 BPM. MIDI export uses format 0, 480 ticks per quarter note, a tempo event, and a General MIDI program change. Adjacent repeated pitches emit note-off before note-on at the shared tick.

Validation allows BPM 40-240, up to 512 notes, MIDI pitch 21-108, start 0-256 beats, duration 0.0625-64 beats, end at or before beat 320, and velocity 0.01-1. Incoming note IDs are regenerated during validation. MIDI programs are 0-127; the editor maps Soft keys, Clear bell, and Synth to programs 0, 10, and 80.

## Configuration and hosting

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listening address; use `0.0.0.0` inside a container |
| `PORT` | `8080` | HTTP port |
| `HUMNOTE_ALLOWED_ORIGINS` | Empty | Comma-separated additional exact origins, such as an HTTPS reverse-proxy origin |

Same-origin requests are accepted. Extra allowed origins enable origin validation behind a development proxy or reverse proxy; they do not enable cross-origin browser CORS by themselves. Requests without an Origin header, such as command-line clients, are supported.

For internet hosting, place the application behind HTTPS and configure the public origin explicitly if the proxy changes scheme or host. There is no built-in user authentication or per-user rate limiting; add access control and request limits at the proxy when exposing it publicly. Never enable request-body or Authorization-header logging. This repository upload does not deploy a live service, and GitHub Pages cannot execute the Java backend.

## Tests

```sh
bash mvnw test
npm test --prefix frontend
npm run test:inference --prefix frontend
npm run build --prefix frontend
```

Java tests cover melody bounds, MIDI tempo/timing/velocity/program values, same-tick event order, HTTP validation, origin and payload limits, provider routing, malformed provider results, and safe timeout/error handling. Frontend tests cover editing data validation and quantization. The inference check runs the included Basic Pitch model on synthetic tones and silence; it does not establish real-world humming accuracy. AI tests use a controlled transport and never spend provider credits.

## Repository layout

```text
src/main/java/io/humnote/    Spring Boot API, music model, validation, MIDI and AI services
src/main/resources/         Default and development configuration
src/test/java/io/humnote/    Java unit and HTTP tests
frontend/app/               Music editor and styles
frontend/components/ui/     Reused interface primitives
frontend/lib/music/         Browser audio processing and editor helpers
frontend/public/model/      Bundled Basic Pitch model and its license
frontend/tests/             Editor and real-model inference checks
.github/workflows/          Build and verification automation
pom.xml                     Java build and executable JAR packaging
```

## Limitations

Designed for short, unaccompanied melodies. Noise, vibrato, slides, chords, and accompaniment can create incorrect or fragmented notes that need manual correction. The model runs on the device and may be slow on less powerful hardware. Playback uses lightweight oscillator sounds, not a sampled instrument library. Multi-track separation, automatic tempo detection, account storage, and cloud project sync are not implemented.

The Java backend replaces the original TypeScript server route and browser MIDI exporter. The browser editor, local audio model, project JSON format, and editing workflow are retained. Cloudflare/Vinext scaffolding and unused demo/database code are omitted from this edition.

## Third-party software

- [Spotify Basic Pitch TypeScript](https://github.com/spotify/basic-pitch-ts), Apache-2.0. The bundled model license is in [`frontend/public/model/LICENSE`](frontend/public/model/LICENSE).
- [TensorFlow.js](https://github.com/tensorflow/tfjs), Apache-2.0.
- [Spring Boot](https://spring.io/projects/spring-boot), Apache-2.0.
- [React](https://react.dev/), [Vite](https://vite.dev/), and [Tailwind CSS](https://tailwindcss.com/), MIT.
- Interface primitives adapted from the supplied source use [Radix UI](https://www.radix-ui.com/) and shadcn-style components.

Third-party components retain their respective licenses. No new license is assigned to the application source by this migration; the repository owner may choose one separately.
