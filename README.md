# KinBeat

KinBeat finds exposed secrets in chats, files and public GitHub repositories, such as cloud keys, tokens and passwords, and tells you which ones are real. Built for the Meta Global AI Developer Hackathon (Indie track).

## Meta model

- Meta's Muse Spark Open is the judge, served on a partner endpoint (Modal). It is the only model that makes decisions at runtime.
- `MODEL_API_BASE_URL` and `MODEL_API_MODEL` in `api/.env` choose the endpoint and the model.
- Rules find the candidates. Each secret is masked first, and the model sees only a small masked slice of text around it.
- The same Muse model reads pictures and scanned PDF pages as text. A picture is sent whole, because nothing can be masked before it is read.
- The model says whether a finding is real, possible or an example, and gives a one-sentence reason. The page groups findings this way.
- Without `MODEL_API_KEY` the app runs a simple mock judge, and every result says `mode: mock`.

## Run

Needs Node 22.13 or newer. Postgres is optional.

```bash
npm install && cp api/.env.example api/.env && npm run dev
```

- Open `http://localhost:3001`. One command starts the API and the web page.
- Put your Muse key in `api/.env` as `MODEL_API_KEY` to use the real model.

## Try it

- Pick a sample, paste a chat, upload one file (text, PDF, Word, image or zip), or paste the link of a public GitHub repository.
- Each finding shows where it was found, a confidence level and why the KinBeat AI judged it that way.

## Open-source software used

- Server: NestJS, `pg`, `dotenv`, `jszip`, `mammoth`, `pdfjs-dist`, `@napi-rs/canvas`, RxJS.
- Web: Next.js, React.
