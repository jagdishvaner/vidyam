"""`pnpm models:setup`: the self-hosted Qwen3 search models (plan v3 §8, step 17), ready for llama-server.

- Qwen3-Embedding-4B: Qwen's own GGUF build at Q8_0, checked against its published SHA-256.
- Qwen3-Reranker-4B: Qwen publishes no GGUF of it, and many community conversions lack the classifier tensor
  (`cls.output.weight`), so they load and answer but every score is meaningless. It is converted here from
  Qwen's official weights with llama.cpp's own converter, from the same commit as the installed llama-server;
  the classifier is checked; and its scores are compared with Qwen's reference implementation
  (`verify_reranker.py`). The original weights are deleted afterwards.

Models go to $VIDYAM_MODELS_DIR (default ~/.vidyam/models), outside git. Safe to run again: finished files
are kept. Needs llama.cpp (`brew install llama.cpp` on macOS) and uv. Standard library only.

    pnpm models:setup                 # both models (the reranker check takes a few minutes)
    pnpm models:setup --small         # the 0.6B pair instead (CI, or a machine with little memory)
    pnpm models:setup --skip-verify   # convert the reranker without the reference comparison
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).parent
HF = "https://huggingface.co"


@dataclass(frozen=True)
class Pair:
    embedding_repo: str
    embedding_revision: str  # pinned, so every machine serves the same weights
    embedding_file: str
    reranker_repo: str
    reranker_revision: str
    reranker_file: str  # what the conversion is saved as


PAIRS = {
    "4b": Pair(
        "Qwen/Qwen3-Embedding-4B-GGUF",
        "f4602530db1d980e16da9d7d3a70294cf5c190be",
        "Qwen3-Embedding-4B-Q8_0.gguf",
        "Qwen/Qwen3-Reranker-4B",
        "22e683669bc0f0bd69640a1354a6d0aebcfeede5",
        "qwen3-reranker-4b-q8_0.gguf",
    ),
    "0.6b": Pair(
        "Qwen/Qwen3-Embedding-0.6B-GGUF",
        "370f27d7550e0def9b39c1f16d3fbaa13aa67728",
        "Qwen3-Embedding-0.6B-Q8_0.gguf",
        "Qwen/Qwen3-Reranker-0.6B",
        "e61197ed45024b0ed8a2d74b80b4d909f1255473",
        "qwen3-reranker-0.6b-q8_0.gguf",
    ),
}


def models_dir() -> Path:
    return Path(os.environ.get("VIDYAM_MODELS_DIR", Path.home() / ".vidyam" / "models")).expanduser()


def say(message: str) -> None:
    print(f"models: {message}", flush=True)


def fail(message: str) -> None:
    print(f"models: {message}", file=sys.stderr)
    sys.exit(1)


def get_json(url: str) -> object:
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.load(response)


def resolve_revision(repo: str, revision: str) -> str:
    """The commit a branch name points at, so what was downloaded is recorded exactly."""
    info = get_json(f"{HF}/api/models/{repo}/revision/{revision}")
    assert isinstance(info, dict)
    return str(info["sha"])


def repo_files(repo: str, revision: str) -> dict[str, tuple[int, str | None]]:
    """File name → (size, SHA-256 for large files)."""
    listing = get_json(f"{HF}/api/models/{repo}/tree/{revision}?recursive=true")
    assert isinstance(listing, list)
    files: dict[str, tuple[int, str | None]] = {}
    for entry in listing:
        if entry.get("type") == "file":
            lfs = entry.get("lfs") or {}
            files[entry["path"]] = (int(lfs.get("size", entry.get("size", 0))), lfs.get("oid"))
    return files


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def download(url: str, target: Path, size: int, expected_sha: str | None) -> None:
    """Resumable (curl -C -), then checked against the published SHA-256 when there is one."""
    if (
        target.exists()
        and target.stat().st_size == size
        and (expected_sha is None or sha256(target) == expected_sha)
    ):
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    say(f"downloading {target.name} ({size / 1e9:.2f} GB)")
    # Long downloads drop now and then; each attempt resumes where the last one stopped.
    # A connection can also stay open and go silent: below 10 kB/s for a minute counts as dropped.
    command = ["curl", "-fL", "--retry", "5", "--retry-all-errors", "--retry-delay", "3", "-C", "-"]
    command += ["--speed-limit", "10000", "--speed-time", "60"]
    for attempt in range(1, 21):
        if subprocess.run([*command, "-o", str(partial), url]).returncode == 0:
            break
        say(f"{target.name}: download interrupted, resuming (attempt {attempt + 1})")
    else:
        fail(f"{target.name}: download keeps failing; check the connection and run again (it resumes)")
    if expected_sha and sha256(partial) != expected_sha:
        partial.unlink()
        fail(f"{target.name}: checksum mismatch; run again to download it afresh")
    partial.rename(target)


def llama_commit() -> str:
    """The llama.cpp commit the installed llama-server was built from ("build 11669, commit 620d2225c")."""
    server = shutil.which("llama-server")
    if not server:
        fail("llama-server not found. On macOS: brew install llama.cpp")
    result = subprocess.run([server, "--version"], capture_output=True, text=True)
    output = result.stdout + result.stderr
    match = re.search(r"commit ([0-9a-f]{7,40})", output)
    if not match:
        fail(f"can't tell which llama.cpp commit llama-server is: {output.strip()}")
    return match.group(1)


def llama_source(commit: str, cache: Path) -> Path:
    """llama.cpp's converter and gguf-py, from the commit the server was built from."""
    source = cache / f"llama.cpp-{commit}"
    if (source / "convert_hf_to_gguf.py").exists():
        return source
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / f"llama.cpp-{commit}.tar.gz"
    say(f"fetching llama.cpp's converter at commit {commit}")
    subprocess.run(
        [
            "curl",
            "-fL",
            "-o",
            str(archive),
            f"https://codeload.github.com/ggml-org/llama.cpp/tar.gz/{commit}",
        ],
        check=True,
    )
    with tarfile.open(archive) as tar:
        top = tar.getnames()[0].split("/")[0]
        tar.extractall(cache, filter="data")
    (cache / top).rename(source)
    archive.unlink()
    return source


def converter_env(source: Path) -> list[str]:
    """`uv run` in a throwaway environment with the converter's own requirements (CPU torch included)."""
    requirements = source / "requirements" / "requirements-convert_hf_to_gguf.txt"
    return ["uv", "run", "--no-project", "--python", "3.12", "--with-requirements", str(requirements)]


def has_classifier(source: Path, gguf: Path) -> bool:
    dump = subprocess.run(
        [
            *converter_env(source),
            "python",
            str(source / "gguf-py" / "gguf" / "scripts" / "gguf_dump.py"),
            str(gguf),
        ],
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONPATH": str(source / "gguf-py")},
    )
    return "cls.output.weight" in dump.stdout


def setup_embedding(pair: Pair, target_dir: Path) -> dict[str, str]:
    revision = resolve_revision(pair.embedding_repo, pair.embedding_revision)
    size, sha = repo_files(pair.embedding_repo, revision)[pair.embedding_file]
    target = target_dir / pair.embedding_file
    download(f"{HF}/{pair.embedding_repo}/resolve/{revision}/{pair.embedding_file}", target, size, sha)
    say(f"embedding model ready: {target}")
    return {"repo": pair.embedding_repo, "revision": revision, "file": target.name, "sha256": sha or ""}


def setup_reranker(pair: Pair, target_dir: Path, *, verify: bool) -> dict[str, str]:
    target = target_dir / pair.reranker_file
    revision = resolve_revision(pair.reranker_repo, pair.reranker_revision)
    cache = target_dir / ".build"
    commit = llama_commit()
    source = llama_source(commit, cache)
    if target.exists() and has_classifier(source, target):
        say(f"reranker ready: {target}")
        return {"repo": pair.reranker_repo, "revision": revision, "file": target.name, "llamaCommit": commit}

    weights = cache / pair.reranker_repo.replace("/", "--")
    for name, (size, sha) in repo_files(pair.reranker_repo, revision).items():
        if "/" not in name and name != ".gitattributes" and not name.endswith(".md"):
            download(f"{HF}/{pair.reranker_repo}/resolve/{revision}/{name}", weights / name, size, sha)

    say("converting the reranker with llama.cpp's converter (a few minutes)")
    with tempfile.TemporaryDirectory(dir=target_dir) as work:
        converted = Path(work) / pair.reranker_file
        subprocess.run(
            [
                *converter_env(source),
                "python",
                str(source / "convert_hf_to_gguf.py"),
                str(weights),
                "--outfile",
                str(converted),
                "--outtype",
                "q8_0",
            ],
            check=True,
            env={**os.environ, "PYTHONPATH": str(source / "gguf-py")},
        )
        if not has_classifier(source, converted):
            fail(
                "the converted reranker has no classifier tensor (cls.output.weight): "
                "its scores would be useless"
            )
        converted.rename(target)
    say(f"reranker converted: {target}")

    if verify:
        say("comparing reranker scores with Qwen's reference implementation")
        subprocess.run(
            [
                "uv",
                "run",
                "--no-project",
                "--python",
                "3.12",
                "--with",
                "torch==2.14.1",
                "--with",
                "transformers==5.21.0",
                "python",
                str(HERE / "verify_reranker.py"),
                "--weights",
                str(weights),
                "--gguf",
                str(target),
            ],
            check=True,
        )
    shutil.rmtree(weights)  # the original weights are only needed to convert and check
    return {"repo": pair.reranker_repo, "revision": revision, "file": target.name, "llamaCommit": commit}


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--small", action="store_true", help="the 0.6B pair instead of the 4B one")
    parser.add_argument("--skip-verify", action="store_true", help="skip the reference comparison")
    args = parser.parse_args()
    if not shutil.which("uv"):
        fail("uv not found (https://docs.astral.sh/uv/)")
    size = "0.6b" if args.small else "4b"
    pair = PAIRS[size]
    target_dir = models_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "size": size,
        "embedding": setup_embedding(pair, target_dir),
        "reranker": setup_reranker(pair, target_dir, verify=not args.skip_verify),
    }
    (target_dir / f"models-{size}.json").write_text(json.dumps(manifest, indent=2) + "\n")
    say(f"done. Start them with: pnpm models:up{' --small' if args.small else ''}")


if __name__ == "__main__":
    main()
