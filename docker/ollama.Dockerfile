# ollama.Dockerfile — the AI model server with the model already inside (owner, Prompt 347, D116).
#
# The official Ollama image + qwen3:4b downloaded while the image is built, so the first start
# needs no download and the model is there even offline. The download (~2.5 GB) happens once,
# during the first `docker compose up -d`.
# The version matches the one the project was built and measured with.

FROM ollama/ollama:0.34.4

ARG OLLAMA_MODEL=qwen3:4b

# Start the server for a moment, wait until it answers, download the model, stop the server.
RUN ollama serve > /tmp/ollama-build.log 2>&1 & \
    server=$!; \
    tries=0; \
    until ollama list > /dev/null 2>&1; do \
      tries=$((tries + 1)); \
      if [ "$tries" -gt 60 ]; then echo "Ollama did not start"; cat /tmp/ollama-build.log; exit 1; fi; \
      sleep 1; \
    done; \
    ollama pull "$OLLAMA_MODEL" && kill "$server"; \
    status=$?; wait "$server" 2> /dev/null; exit $status
