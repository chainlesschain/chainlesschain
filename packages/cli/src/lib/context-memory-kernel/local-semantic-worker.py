"""Production opt-in Memory encoder. Existing local BGE snapshot only; no downloads."""
import hashlib
import json
import os
from pathlib import Path
import socket
import sys

SCHEMA = "chainlesschain.memory-local-semantic/v1"
REVISION = "a5beb1e3e68b9ab74eb54cfd186867f64f240e1a"
MODEL_FILES = {
    "config.json": "bc00af31a4a31b74040d73370aa83b62da34c90b75eb77bfa7db039d90abd591",
    "tokenizer.json": "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
    "tokenizer_config.json": "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
    "special_tokens_map.json": "b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3",
    "vocab.txt": "07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3",
    "model.safetensors": "c7c1988aae201f80cf91a5dbbd5866409503b89dcaba877ca6dba7dd0a5167d7",
}
INSTRUCTION = "Represent this sentence for searching relevant passages: "
NETWORK_CALLS = 0


def refuse_network(*_args, **_kwargs):
    global NETWORK_CALLS
    NETWORK_CALLS += 1
    raise RuntimeError("Offline Memory worker refused networking")


def check_model(directory):
    for name, expected in MODEL_FILES.items():
        with (directory / name).open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != expected:
            raise ValueError("BGE model/tokenizer identity mismatch")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.environ.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
                       "TOKENIZERS_PARALLELISM": "false", "CUDA_VISIBLE_DEVICES": ""})
    socket.socket.connect = refuse_network
    socket.socket.connect_ex = refuse_network
    socket.create_connection = refuse_network
    socket.getaddrinfo = refuse_network
    raw = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError("Semantic input too large")
    request = json.loads(raw)
    if request.get("schema") != SCHEMA:
        raise ValueError("Invalid semantic schema")
    query = request.get("query")
    records = request.get("records")
    threads = request.get("threads")
    if (not isinstance(query, str) or not query.strip() or len(query) > 32768 or
            not isinstance(records, list) or not 1 <= len(records) <= 10000 or
            type(threads) is not int or not 1 <= threads <= 8):
        raise ValueError("Invalid bounded semantic input")
    seen = set()
    for record in records:
        identifier = record.get("memoryId")
        if (not isinstance(identifier, str) or not identifier or identifier in seen or
                not isinstance(record.get("content"), str)):
            raise ValueError("Invalid semantic record")
        seen.add(identifier)
    directory = Path(request["modelDirectory"])
    if not directory.is_absolute():
        raise ValueError("Model directory must be absolute")
    check_model(directory)
    import torch
    from transformers import AutoModel, AutoTokenizer
    torch.set_num_threads(threads)
    torch.set_num_interop_threads(1)
    torch.manual_seed(0)
    torch.use_deterministic_algorithms(True)
    tokenizer = AutoTokenizer.from_pretrained(str(directory), local_files_only=True, trust_remote_code=False)
    model = AutoModel.from_pretrained(str(directory), local_files_only=True,
                                    trust_remote_code=False, use_safetensors=True).eval().to("cpu")

    def encode(texts):
        batch = tokenizer(texts, truncation=True, max_length=512, padding=True, return_tensors="pt")
        result = torch.nn.functional.normalize(model(**batch).last_hidden_state[:, 0], p=2, dim=1)
        if not torch.isfinite(result).all():
            raise ValueError("Nonfinite model embedding")
        return result

    scores = []
    with torch.inference_mode():
        query_vector = encode([INSTRUCTION + query])[0]
        for start in range(0, len(records), 8):
            batch = records[start:start + 8]
            values = (encode([record["content"] for record in batch]) @ query_vector).tolist()
            scores.extend({"memoryId": record["memoryId"], "score": max(0.0, min(1.0, value))}
                          for record, value in zip(batch, values))
    check_model(directory)
    if NETWORK_CALLS:
        raise RuntimeError("Network was attempted")
    print(json.dumps({"schema": SCHEMA, "modelRevision": REVISION,
                      "requestDigest": hashlib.sha256(raw).hexdigest(),
                      "networkCalls": NETWORK_CALLS, "scores": scores}, allow_nan=False, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Input content and library exception text never cross the diagnostic boundary.
        sys.stderr.write("Local semantic worker failed; check model identity and local dependencies.\n")
        sys.exit(1)

