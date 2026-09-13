# SermonWise

Turn a YouTube sermon into a searchable study page with a summary, key takeaways, highlighted moments, and a transcript. Organize your library by passage, topic, speaker, and series. The library is saved in your browser, so no account is required.

## Run locally

Requires Node.js 20+. Run `npm start` and open `http://localhost:3000`. Run `npm test` for automated tests.

Add `OPENAI_API_KEY` to your environment to enable AI-written notes and transcription when captions are unavailable. Without a key, videos with captions still produce extractive notes; you can also paste a transcript. Captionless videos require the key plus `yt-dlp` and `ffmpeg` on the server (included in the Docker image). Audio is limited to 24 MB and five minutes of download time. Some YouTube videos restrict extraction; paste a transcript in that case. Only process videos you have permission to use.

## Deploy

CI runs checks, tests, and a Docker build on every pull request and push to `main`. Connect this repository to [Render](https://render.com/) using the included `render.yaml` Blueprint. Render automatically deploys successful commits on `main`. Add `OPENAI_API_KEY` as a secret environment variable in Render for captionless transcription and AI notes. The `/health` endpoint supports health checks.

The first release stores sermons in each browser's local storage. Shared church libraries, accounts, and durable storage are future work; browser storage can be cleared, so use the JSON export to keep a backup.
