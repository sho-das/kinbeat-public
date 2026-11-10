# The small chat model for cheap first-pass judging and fallback, served by Ollama on a Cloud Run processor.
# The model weights are pulled at build time, so a cold start loads from disk instead of downloading.
FROM ollama/ollama:latest

ARG MODEL=phi4-mini
ENV OLLAMA_HOST=0.0.0.0:8080 \
    OLLAMA_MODELS=/models \
    OLLAMA_KEEP_ALIVE=-1 \
    OLLAMA_NUM_PARALLEL=1 \
    MODEL=${MODEL}

RUN mkdir -p /models && (ollama serve & sleep 6 && ollama pull "$MODEL" && pkill -f "ollama serve") && ls -la /models

EXPOSE 8080
ENTRYPOINT ["ollama", "serve"]
