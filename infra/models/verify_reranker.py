"""Checks a converted Qwen3-Reranker GGUF against Qwen's reference implementation (plan v3 §11: verify the
reranker's prompt format and scores before relying on them). Run by `setup.py` in a throwaway environment with
torch and transformers; it starts its own llama-server on a spare port.

The reference is the model card's code: the pair is wrapped in Qwen's judge prompt, and the score is the
probability of "yes" against "no" at the last position. The GGUF must give the same ranking for every query,
and scores within a small tolerance (Q8_0 weights against bfloat16).
"""

import argparse
import json
import math
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

INSTRUCTION = "Given a web search query, retrieve relevant passages that answer the query"
PREFIX = (
    "<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the "
    'Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>\n<|im_start|>user\n'
)
SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
TOLERANCE = 0.08

# Hindi, English and Hinglish queries over passages like the demo pack's, with relevant and unrelated text.
CASES = [
    (
        "त्वरण का SI मात्रक क्या है?",
        [
            "त्वरण (Acceleration) वेग में परिवर्तन की दर है। त्वरण सदिश राशि है और इसका SI मात्रक m/s² है।",
            "दूरी किसी वस्तु द्वारा तय किए गए वास्तविक पथ की कुल लंबाई है। इसका SI मात्रक मीटर है।",
            "पौधे प्रकाश संश्लेषण द्वारा अपना भोजन स्वयं बनाते हैं।",
        ],
    ),
    (
        "What is Ohm's law?",
        [
            "Ohm's law states that the current through a conductor is proportional to the potential "
            "difference across it, V = IR, at constant temperature.",
            "Electric power is the rate at which electrical energy is consumed, P = VI.",
            "Carbon forms covalent bonds by sharing electrons.",
        ],
    ),
    (
        "newton ka teesra niyam",
        [
            "न्यूटन का तृतीय नियम: प्रत्येक क्रिया के बराबर और विपरीत प्रतिक्रिया होती है।",
            "जड़त्व किसी वस्तु का वह गुण है जिसके कारण वह अपनी अवस्था में परिवर्तन का विरोध करती है।",
            "Acids turn blue litmus red.",
        ],
    ),
    (
        "अम्ल और क्षारक की पहचान",
        [
            "Acids turn blue litmus red and bases turn red litmus blue; indicators show whether a solution "
            "is acidic or basic.",
            "अम्ल नीले लिटमस को लाल कर देते हैं, जबकि क्षारक लाल लिटमस को नीला कर देते हैं।",
            "The speedometer of a vehicle measures instantaneous speed.",
        ],
    ),
]


def reference_scores(weights: str) -> list[list[float]]:
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    tokenizer = AutoTokenizer.from_pretrained(weights, padding_side="left")
    model = AutoModelForCausalLM.from_pretrained(weights, dtype=torch.bfloat16).to(device).eval()
    yes, no = tokenizer.convert_tokens_to_ids("yes"), tokenizer.convert_tokens_to_ids("no")
    prefix = tokenizer.encode(PREFIX, add_special_tokens=False)
    suffix = tokenizer.encode(SUFFIX, add_special_tokens=False)
    results: list[list[float]] = []
    for query, documents in CASES:
        scores: list[float] = []
        for document in documents:
            pair = f"<Instruct>: {INSTRUCTION}\n<Query>: {query}\n<Document>: {document}"
            ids = prefix + tokenizer.encode(pair, add_special_tokens=False) + suffix
            with torch.no_grad():
                logits = model(torch.tensor([ids], device=device)).logits[0, -1, :]
            pair_logits = torch.stack([logits[no], logits[yes]]).float()
            scores.append(torch.softmax(pair_logits, dim=0)[1].item())
        results.append(scores)
    return results


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def llama_scores(gguf: str) -> list[list[float]]:
    port = free_port()
    server = subprocess.Popen(
        [
            shutil.which("llama-server") or "llama-server",
            "-m",
            gguf,
            "--reranking",
            "--pooling",
            "rank",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "-c",
            "4096",
            "-ub",
            "2048",
            "-b",
            "2048",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(240):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as response:
                    if response.status == 200:
                        break
            except OSError:
                time.sleep(0.5)
        else:
            sys.exit("llama-server didn't start")
        results: list[list[float]] = []
        for query, documents in CASES:
            body = json.dumps({"query": query, "documents": documents}).encode()
            request = urllib.request.Request(
                f"http://127.0.0.1:{port}/v1/rerank", body, {"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                ranked = json.load(response)["results"]
            scores = [0.0] * len(documents)
            for item in ranked:
                scores[item["index"]] = float(item["relevance_score"])
            results.append(scores)
        return results
    finally:
        server.terminate()
        server.wait()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True)
    parser.add_argument("--gguf", required=True)
    args = parser.parse_args()
    reference = reference_scores(args.weights)
    served = llama_scores(args.gguf)
    # llama-server reports either the "yes" probability or its logit against "no"; accept the form that fits.
    flat = [s for scores in served for s in scores]
    if any(s < 0 or s > 1 for s in flat):
        served = [[1 / (1 + math.exp(-s)) for s in scores] for scores in served]
        print("llama-server returns logits; the client applies a sigmoid")
    worst = 0.0
    ok = True
    for (query, _), want, got in zip(CASES, reference, served, strict=True):
        order_ok = sorted(range(len(want)), key=lambda i: -want[i]) == sorted(
            range(len(got)), key=lambda i: -got[i]
        )
        worst = max(worst, *(abs(a - b) for a, b in zip(want, got, strict=True)))
        ok &= order_ok
        print(f"{query[:40]:<40} reference {[round(s, 3) for s in want]}  gguf {[round(s, 3) for s in got]}")
    print(f"largest score difference: {worst:.3f} (tolerance {TOLERANCE})")
    if not ok or worst > TOLERANCE:
        sys.exit("the converted reranker does not match the reference implementation")
    print("the converted reranker matches the reference implementation")


if __name__ == "__main__":
    main()
