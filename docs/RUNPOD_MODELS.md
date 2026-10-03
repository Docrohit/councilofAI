# RunPod and self-hosted models

Council can use self-hosted RunPod models through any OpenAI-compatible endpoint,
including vLLM. The important boundary is machine-local networking: `127.0.0.1`
always means the machine running that process.

## Desktop or local web app on your Mac

If Council runs on your Mac and RunPod serves vLLM inside the pod, open an SSH
tunnel from a Mac terminal:

```sh
ssh -o IdentitiesOnly=yes -i ~/.ssh/gpu \
  -L 18100:127.0.0.1:8100 \
  -p RUNPOD_SSH_PORT root@RUNPOD_SSH_HOST
```

Then add a Council connection:

| Field | Value |
| --- | --- |
| Provider | `vLLM` |
| Connection type | `Direct from this server` |
| Base URL | `http://127.0.0.1:18100/v1` |
| Model ID | `qwen38-heretic` or the exact served model ID |
| API key | blank unless your server requires one |

Use **Test** before adding the model to a team. The test performs a small real
completion through the configured endpoint.

## Council running inside RunPod

If the Council server itself runs on the pod, use the pod-local endpoint:

```text
Base URL: http://127.0.0.1:8100/v1
Model ID: qwen38-heretic
```

For the known Heretic setup, activate the model inside RunPod first:

```sh
source /workspace/apps/env.sh
modelctl use heretic
modelctl status
curl -fsS http://127.0.0.1:8100/health
curl -fsS http://127.0.0.1:8100/v1/models
```

Do not infer readiness from an old endpoint, a prior tunnel or a running process
alone. Check the current RunPod Connect address, model health, `/v1/models`, and
a small completion after each pod restart or migration.

## Hosted Council with private RunPod models

A hosted Council server cannot directly reach a private RunPod `127.0.0.1`
endpoint. Use a bridge worker from the machine that can reach the model, or expose
a deliberately secured HTTPS endpoint yourself.

Bridge mode keeps the model private: the worker makes outbound authenticated
requests to Council and forwards model streams from its own local URL.

## Terminal CLI

From a Mac project directory, after the tunnel is open:

```sh
council models add --name heretic --kind vllm \
  --model qwen38-heretic \
  --url http://127.0.0.1:18100/v1

council --providers heretic --agents 3 --concurrency 1
```

During a running TUI session, use `/board-msg` for shared guidance and `/dm` or
`/chat` for a direct message to one peer.

