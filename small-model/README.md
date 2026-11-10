# Small model service

Ollama with one small open model, built into the image, for Cloud Run on a processor (no graphics card).

Build and deploy (from this folder):

```bash
gcloud builds submit . --tag europe-west2-docker.pkg.dev/kinbeat/app/small-model:1 --project kinbeat
```

```bash
gcloud run deploy small-model --project kinbeat --region europe-west1 --image europe-west2-docker.pkg.dev/kinbeat/app/small-model:1 --cpu 4 --memory 8Gi --concurrency 1 --min-instances 0 --max-instances 1 --timeout 600 --no-allow-unauthenticated --quiet
```

Only signed-in callers can reach it. It answers Ollama's own API: `POST /api/chat`.

The API reaches it through `SMALL_MODEL_URL` (and `SMALL_MODEL_TOKEN` for a local run); see `.env.example`.
