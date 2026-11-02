# Nalvis 2-minute demo renderer

This Linux pipeline performs read-only Playwright motion captures, runs the independent
v4 verifier against live HashKey mainnet RPC, synthesizes the approved narration
with offline Piper, and renders a 1920x1080 H.264/AAC MP4 with ffmpeg.

```bash
./node_modules/.bin/tsc -p packages/verifier/tsconfig.json
NODE_USE_ENV_PROXY=1 node demo/nalvis-mainnet-video/capture.mjs
PIPER_BIN=/path/to/piper PIPER_MODEL=/path/to/en_US-lessac-medium.onnx \
  node demo/nalvis-mainnet-video/render.mjs
python3 demo/nalvis-mainnet-video/verify.py
```

`capture.mjs` aborts unless the real verifier produces exactly 18 passing
checks. It never connects a wallet, enters an amount, signs, or submits.
Every application scene is a real screen recording with scrolling, pointer
movement, navigation, or safe read-only expansion; the verifier is revealed
from the real command output and the architecture nodes animate in-browser.
Set `PLAYWRIGHT_MODULE` to an installed Playwright `index.mjs` path when
Playwright is supplied by the host rather than this workspace.
