# SermonWise

Turn a YouTube sermon into a searchable study page with a summary, key takeaways, highlighted moments, a transcript, and private reflections. Organize your library by passage, topic, speaker, and series. Email/password accounts keep each person's library private and available across browsers.

## Run locally

Requires Node.js 20+ and PostgreSQL. The simplest local setup is `docker compose up --build`, then open `http://localhost:3000`. The database uses a named volume and persists across container restarts. For a host install, set `DATABASE_URL`, run `npm ci && npm start`, and open the same URL. Run `npm test` for automated tests; set `DATABASE_URL` to include the PostgreSQL integration test.

Add `OPENAI_API_KEY` to your environment to enable AI-written notes and transcription when captions are unavailable. Without a key, videos with captions still produce extractive notes; you can also paste a transcript. Captionless videos require the key plus `yt-dlp` and `ffmpeg` on the server (included in the Docker image). Audio is limited to 24 MB and five minutes of download time. Some YouTube videos restrict extraction; paste a transcript in that case. Only process videos you have permission to use.

## Deploy

CI runs checks, tests against PostgreSQL, and a Docker build on every pull request and push to `main`. Connect this repository to [Render](https://render.com/) using the included `render.yaml` Blueprint. It provisions a managed PostgreSQL database and a web service; the database is configured on Render's smallest **paid** compute plan for durable storage. Review Render's price before creating the Blueprint. Render deploys commits to `main` only after CI passes. Add `OPENAI_API_KEY` as a secret environment variable in Render for captionless transcription and AI notes. The `/health` endpoint checks both the app and database.

Existing browser-only libraries are offered for import after sign-in. JSON export remains available for personal backup. Passwords are salted and hashed; sessions use HTTP-only, SameSite cookies. This release does not yet include password reset or email verification, so use a password manager and keep your library export.
