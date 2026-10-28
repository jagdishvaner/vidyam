"""`pnpm models:up`, and part of `pnpm dev`: the Qwen3 embedding and rerank servers (plan v3 §8), llama.cpp's
llama-server on the Mac's GPU (Metal), at the addresses the AI engine expects:

    http://127.0.0.1:38180/v1/embeddings   Qwen3-Embedding (last-token pooling, L2-normalized)
    http://127.0.0.1:38181/v1/rerank       Qwen3-Reranker

Until `pnpm models:setup` has run, it says so and exits, and the rest of `pnpm dev` runs without search. Both
servers stop together. `--small` serves the 0.6B pair (then set VIDYAM_EMBEDDING_MODEL=qwen3-embedding-0.6b,
VIDYAM_EMBEDDING_DIMS=1024 and VIDYAM_RERANK_MODEL=qwen3-reranker-0.6b). Standard library only.
"""

import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

EMBED_PORT = 38180
RERANK_PORT = 38181
# Chunks are at most ~1,000 tokens and a query-passage pair a little more, so 4,096 tokens per request is
# ample; two requests at a time keeps memory near the weights' own size (plan v3 §11: the Mac shares 24 GB).
COMMON = [
    "--host",
    "127.0.0.1",
    "-c",
    "8192",
    "-np",
    "2",
    "-ub",
    "4096",
    "-b",
    "4096",
    "-ngl",
    "99",
    "-fa",
    "on",
]


def main() -> None:
    small = "--small" in sys.argv[1:]
    size = "0.6b" if small else "4b"
    folder = Path(os.environ.get("VIDYAM_MODELS_DIR", Path.home() / ".vidyam" / "models")).expanduser()
    manifest = folder / f"models-{size}.json"
    server = shutil.which("llama-server")
    if server is None or not manifest.exists():
        print(f"models: not set up yet (run pnpm models:setup{' --small' if small else ''}); search is off")
        return
    files = json.loads(manifest.read_text())
    commands = [
        [
            server,
            "-m",
            str(folder / files["embedding"]["file"]),
            "--alias",
            f"qwen3-embedding-{size}",
            "--embedding",
            "--pooling",
            "last",
            "--port",
            str(EMBED_PORT),
            *COMMON,
        ],
        [
            server,
            "-m",
            str(folder / files["reranker"]["file"]),
            "--alias",
            f"qwen3-reranker-{size}",
            "--reranking",
            "--pooling",
            "rank",
            "--port",
            str(RERANK_PORT),
            *COMMON,
        ],
    ]
    processes = [subprocess.Popen(command) for command in commands]

    def stop(*_: object) -> None:
        for process in processes:
            if process.poll() is None:
                process.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    print(f"models: embeddings on :{EMBED_PORT}, rerank on :{RERANK_PORT} (Qwen3 {size}, Metal)", flush=True)
    try:
        while all(process.poll() is None for process in processes):
            time.sleep(0.5)
    finally:
        stop()
        for process in processes:
            process.wait()
    sys.exit(max(process.returncode or 0 for process in processes))


if __name__ == "__main__":
    main()
