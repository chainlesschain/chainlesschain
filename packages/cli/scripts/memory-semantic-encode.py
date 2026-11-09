"""Encode a supplied BEIR corpus with an existing, offline BGE snapshot.

This evaluation worker never downloads a model or dataset. Its output is an
input artifact for the canonical Memory retrieval comparison, not a production
candidate service or a claim about real user-task quality.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import socket
import sys
import time

MODEL_FILES = (
    "config.json", "tokenizer.json", "tokenizer_config.json",
    "special_tokens_map.json", "vocab.txt", "model.safetensors",
)
MODEL_FILE_SHA256 = {
    "config.json": "bc00af31a4a31b74040d73370aa83b62da34c90b75eb77bfa7db039d90abd591",
    "tokenizer.json": "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
    "tokenizer_config.json": "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
    "special_tokens_map.json": "b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3",
    "vocab.txt": "07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3",
    "model.safetensors": "c7c1988aae201f80cf91a5dbbd5866409503b89dcaba877ca6dba7dd0a5167d7",
}
QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "
NETWORK_CALLS = 0


def refuse_network(*_args, **_kwargs):
    global NETWORK_CALLS
    NETWORK_CALLS += 1
    raise RuntimeError("Offline Memory encoding refused a network connection")


def file_identity(file):
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return {"sha256": digest.hexdigest(), "bytes": file.stat().st_size}


def load_rows(file, maximum):
    if file.stat().st_size > 64 * 1024 * 1024:
        raise ValueError("Dataset input exceeds 64 MiB")
    rows = []
    seen = set()
    with file.open("r", encoding="utf8") as stream:
        for line in stream:
            row = json.loads(line)
            identifier = row.get("_id")
            text = row.get("text")
            title = row.get("title", "")
            if (not isinstance(identifier, str) or not identifier or
                    identifier in seen or not isinstance(text, str) or
                    not isinstance(title, str) or len(text) > 32768):
                raise ValueError("Malformed or duplicate dataset row")
            seen.add(identifier)
            rows.append({"id": identifier, "text": (title + "\n\n" + text).strip()})
            if len(rows) > maximum:
                raise ValueError("Dataset row bound exceeded")
    if not rows:
        raise ValueError("Dataset input is empty")
    return sorted(rows, key=lambda row: row["id"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--model-id", default="BAAI/bge-base-en-v1.5")
    parser.add_argument("--model-revision", required=True)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--queries", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=8)
    args = parser.parse_args()
    if not 1 <= args.threads <= 32 or not 1 <= args.batch_size <= 64:
        raise ValueError("Invalid CPU thread or batch bound")
    if args.model_id != "BAAI/bge-base-en-v1.5":
        raise ValueError("This worker implements the reviewed BGE v1.5 contract")
    if len(args.model_revision) != 40 or any(c not in "0123456789abcdef" for c in args.model_revision):
        raise ValueError("A fixed model revision is required")
    if args.output_dir.exists():
        raise FileExistsError("Keep existing encoding evidence; choose a new output directory")
    args.output_dir.mkdir(parents=True)
    os.environ.update({
        "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
        "TOKENIZERS_PARALLELISM": "false", "CUDA_VISIBLE_DEVICES": "",
    })
    socket.socket.connect = refuse_network
    socket.create_connection = refuse_network
    started = time.perf_counter()
    worker_identity = file_identity(Path(__file__))
    inputs = {"corpus": file_identity(args.corpus), "queries": file_identity(args.queries)}
    model_files = {name: file_identity(args.model_dir / name) for name in MODEL_FILES}
    if any(model_files[name]["sha256"] != MODEL_FILE_SHA256[name] for name in MODEL_FILES):
        raise ValueError("Model/tokenizer bytes do not match the reviewed fixed BGE snapshot")
    if args.model_revision != "a5beb1e3e68b9ab74eb54cfd186867f64f240e1a":
        raise ValueError("Model revision does not match the reviewed snapshot")
    state = {
        "schema": "chainlesschain.memory-semantic-encoding/v1",
        "complete": False, "stage": "loading", "networkCalls": 0,
        "modelId": args.model_id, "modelRevision": args.model_revision,
        "modelFiles": model_files, "inputFiles": inputs, "worker": worker_identity,
        "pooling": "normalized CLS", "dtype": "float32-le", "maxTokens": 512,
        "queryInstruction": QUERY_INSTRUCTION, "device": "cpu",
        "threads": args.threads, "batchSize": args.batch_size,
        "python": sys.version.split()[0], "platform": platform.platform(),
        "artifacts": {}, "elapsedSeconds": 0,
        "fullDependencyClosureVerified": False, "productionCandidateSourceConnected": False,
        "qualityAccepted": False, "paidReady": False,
    }
    def checkpoint():
        state["elapsedSeconds"] = round(time.perf_counter() - started, 3)
        state["networkCalls"] = NETWORK_CALLS
        partial = args.output_dir / "encoding-state.partial"
        partial.write_text(json.dumps(state, indent=2) + "\n", encoding="utf8")
        os.replace(partial, args.output_dir / "encoding-state.json")
    checkpoint()
    try:
        import numpy as np
        import torch
        import transformers
        from transformers import AutoTokenizer, AutoModel
        torch.set_num_threads(args.threads)
        torch.set_num_interop_threads(1)
        torch.manual_seed(0)
        torch.use_deterministic_algorithms(True)
        state.update({"torch": torch.__version__, "transformers": transformers.__version__, "numpy": np.__version__})
        tokenizer = AutoTokenizer.from_pretrained(str(args.model_dir), local_files_only=True, trust_remote_code=False)
        model = AutoModel.from_pretrained(str(args.model_dir), local_files_only=True, trust_remote_code=False, use_safetensors=True).eval().to("cpu")
        state["dimensions"] = model.config.hidden_size
        for kind, file, maximum in [("corpus", args.corpus, 100000), ("queries", args.queries, 10000)]:
            rows = load_rows(file, maximum)
            texts = [(QUERY_INSTRUCTION if kind == "queries" else "") + row["text"] for row in rows]
            untruncated = tokenizer(texts, truncation=False, padding=False)
            truncated = sum(len(tokens) > 512 for tokens in untruncated["input_ids"])
            del untruncated
            # Let the tokenizer retain required terminal special tokens. Slicing
            # raw token arrays would silently remove BERT's SEP on long rows.
            encoded = tokenizer(texts, truncation=True, max_length=512, padding=False)
            if any(tokens[0] != tokenizer.cls_token_id or tokens[-1] != tokenizer.sep_token_id for tokens in encoded["input_ids"]):
                raise ValueError("Required BERT special tokens were lost")
            # Length grouping saves padding work without changing the artifact's
            # stable ID order or dropping any document/query from the corpus.
            order = sorted(range(len(rows)), key=lambda index: len(encoded["input_ids"][index]))
            output_file = args.output_dir / (kind + ".f32")
            vectors = np.memmap(output_file, dtype="<f4", mode="w+", shape=(len(rows), model.config.hidden_size))
            state.update({"stage": kind, "completedRows": 0, "totalRows": len(rows)})
            checkpoint()
            with torch.inference_mode():
                for begin in range(0, len(order), args.batch_size):
                    indexes = order[begin:begin + args.batch_size]
                    batch = tokenizer.pad({key: [values[index] for index in indexes] for key, values in encoded.items()}, padding=True, return_tensors="pt")
                    result = torch.nn.functional.normalize(model(**batch).last_hidden_state[:, 0], p=2, dim=1).cpu().numpy()
                    if not np.isfinite(result).all():
                        raise ValueError("Model returned a nonfinite embedding")
                    vectors[indexes] = result.astype("<f4", copy=False)
                    state["completedRows"] += len(indexes)
                    if begin % (args.batch_size * 16) == 0:
                        vectors.flush()
                        checkpoint()
            vectors.flush()
            norms = np.linalg.norm(vectors, axis=1)
            if not np.allclose(norms, 1, rtol=1e-5, atol=1e-5):
                raise ValueError("Embeddings are not unit normalized")
            del vectors
            ids_file = args.output_dir / (kind + "-ids.json")
            ids_file.write_text(json.dumps([row["id"] for row in rows]) + "\n", encoding="utf8")
            state["artifacts"][kind] = {"vectors": file_identity(output_file), "ids": file_identity(ids_file), "rows": len(rows), "truncatedRows": truncated, "specialTokensVerified": True}
            checkpoint()
        if inputs != {"corpus": file_identity(args.corpus), "queries": file_identity(args.queries)}:
            raise ValueError("Dataset changed during encoding")
        if model_files != {name: file_identity(args.model_dir / name) for name in MODEL_FILES}:
            raise ValueError("Model snapshot changed during encoding")
        if worker_identity != file_identity(Path(__file__)):
            raise ValueError("Worker source changed during encoding")
        if NETWORK_CALLS:
            raise ValueError("Offline encoding attempted a network connection")
        state.update({"complete": True, "stage": "complete"})
        checkpoint()
        print(json.dumps({"complete": True, "corpus": state["artifacts"]["corpus"]["rows"], "queries": state["artifacts"]["queries"]["rows"], "elapsedSeconds": state["elapsedSeconds"], "networkCalls": NETWORK_CALLS}))
    except BaseException as error:
        state.update({"complete": False, "stage": "failed", "errorType": type(error).__name__})
        checkpoint()
        raise


if __name__ == "__main__":
    main()
