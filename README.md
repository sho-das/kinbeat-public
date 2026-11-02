# KinBeat

KinBeat finds exposed secrets in chats, files and public GitHub repositories, such as cloud keys, tokens and passwords, and tells you which ones are real. Built for the Meta Global AI Developer Hackathon (Indie track).

## Meta model

- Meta's Muse Spark Open is the judge, served on a partner endpoint (Modal). It is the only model that makes decisions at runtime.
- `MODEL_API_BASE_URL` and `MODEL_API_MODEL` in `.env` choose the endpoint and the model.
- Rules find the candidates. Our own server gets the data, while the AI services get masked data.
- The same Muse model reads pictures and scanned PDF pages as text. A picture is sent whole, because nothing can be masked before it is read.
- The model says whether a finding is real, possible or an example, and gives a one-sentence reason. The page groups findings this way.
- Without `MODEL_API_KEY` the app runs a simple mock judge, and every result says `mode: mock`.

## Run

Needs Node 22.13 or newer. Postgres is optional.

```bash
npm install && cp .env.example .env && npm run dev
```

- Open `https://localhost:3001`. One command starts the API and the web page. Accept the local certificate if the browser asks.
- Put your Muse key in `.env` at the project root as `MODEL_API_KEY` to use the real model.

## Try it

- Pick a sample, paste a chat, upload one file (text, PDF, Word, image or zip), pick a Google Drive file, pick a Slack chat, or paste the link of a GitHub repository.
- Each finding shows where it was found, a confidence level and why the KinBeat AI judged it that way.
- Google Drive needs the three `NEXT_PUBLIC_GOOGLE_` values in `.env`. Slack needs your own Slack app, made from `slack-manifest.yaml`, with its `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` in `.env`.

## Open-source software used

- Server: NestJS, `pg`, `dotenv`, `jszip`, `mammoth`, `pdfjs-dist`, `@napi-rs/canvas`, RxJS.
- Web: Next.js, React.
