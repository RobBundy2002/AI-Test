# SermonWise

SermonWise turns a YouTube sermon into a private study page with a transcript, summary, takeaways, outline, discussion questions, keywords, prayer prompt, and personal reflections. The library can be searched, filtered, favorited, imported, exported, and downloaded as Markdown.

## Run locally

Requires Node.js 20+.

```bash
npm ci
npm start
```

Open `http://localhost:3000`, create an account, and start adding sermons. Without any database config, SermonWise stores local data in `.data/sermonwise.json`, which is ignored by git.

## API keys

Do not put API keys in `public/`, frontend JavaScript, HTML, or browser storage. The browser only calls `/api/analyze`; the server reads `OPENAI_API_KEY` from the environment.

Create a local `.env` file when you want AI-written notes or transcription:

```bash
OPENAI_API_KEY=sk-...
INVITE_CODE=choose-a-private-code
PORT=3000
LOCAL_STORE_PATH=.data/sermonwise.json
```

With no key, captioned videos still produce extractive notes and you can paste a transcript manually. Caption and audio extraction requires `yt-dlp` on the server. Captionless transcription also requires `OPENAI_API_KEY`.
Set `INVITE_CODE` to require that code when creating new accounts. Existing users can still sign in without it.

For local macOS development without Homebrew, install `yt-dlp` into Python:

```bash
python3 -m pip install --user yt-dlp
```

If the installed command is not on your `PATH`, the app also tries `python3 -m yt_dlp`. You can set `YT_DLP_PATH=/absolute/path/to/yt-dlp` in `.env` for a custom install.

## Optional Postgres

Set `DATABASE_URL` to use PostgreSQL instead of the local JSON store:

```bash
DATABASE_URL=postgresql://sermonwise:sermonwise@localhost:5432/sermonwise
```

The included `compose.yaml` and Dockerfile still support a containerized setup with Postgres. Run `docker compose up --build`, then open `http://localhost:3000`.

## Test

```bash
npm run check
npm test
```

`npm test` runs without Postgres by default. Set `DATABASE_URL` to include the PostgreSQL integration test.

## Deploy

Connect this repository to Render with the included `render.yaml` Blueprint. Add `OPENAI_API_KEY` and `INVITE_CODE` as secret environment variables in Render. Keep `DATABASE_URL` managed by Render or another server-side database provider; never expose it to the browser.
