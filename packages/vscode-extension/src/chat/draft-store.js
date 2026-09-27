const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { checkImageEnvelope, writeImageTemps } = require("./image-attachments");

const MAX_TEXT = 100000;
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_STORAGE_BYTES = 100 * 1024 * 1024;
const IMAGE_NAME = /^cc-chat-img-[a-f0-9-]{36}\.(png|jpg|gif|webp)$/;
const KEY = /^[a-f0-9-]{36}$/;
const CLIENT_ID = /^[a-zA-Z0-9_-]{1,80}$/;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function readImageSnapshot(file, expectedSize = null) {
  const info = await fs.lstat(file);
  if (
    !info.isFile() ||
    info.size <= 0 ||
    info.size > 20 * 1024 * 1024 ||
    (expectedSize !== null && info.size !== expectedSize)
  )
    throw new Error("Saved attachment is missing or changed; attach it again");
  const handle = await fs.open(file, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== info.size)
      throw new Error("Saved attachment changed while opening");
    const data = Buffer.alloc(info.size + 1);
    let n = 0;
    while (n < data.length) {
      const r = await handle.read(data, n, data.length - n, n);
      if (!r.bytesRead) break;
      n += r.bytesRead;
    }
    if (n !== info.size)
      throw new Error("Saved attachment changed while reading");
    return data.subarray(0, n);
  } finally {
    await handle.close();
  }
}

function text(value) {
  if (typeof value !== "string" || value.length > MAX_TEXT)
    throw new Error("Draft text exceeds 100,000 characters or is invalid");
  return value;
}
function validImages(images) {
  return (
    Array.isArray(images) &&
    images.length <= 4 &&
    images.every(
      (i) =>
        IMAGE_NAME.test(i.file) &&
        Number.isSafeInteger(i.size) &&
        i.size > 0 &&
        i.size <= 20 * 1024 * 1024 &&
        /^[a-f0-9]{64}$/.test(i.hash) &&
        ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(i.mime),
    ) &&
    images.reduce((n, i) => n + i.size, 0) <= 20 * 1024 * 1024
  );
}

function validQuestion(q) {
  if (
    !q ||
    !KEY.test(q.id) ||
    !/^[a-f0-9]{64}$/.test(q.digest || "") ||
    typeof q.sessionId !== "string" ||
    typeof q.requestId !== "string" ||
    typeof q.title !== "string" ||
    q.title.length > 1024 ||
    !["draft", "archived"].includes(q.status) ||
    !Array.isArray(q.fields) ||
    q.fields.length > 128 ||
    Buffer.byteLength(JSON.stringify(q)) > 128 * 1024
  )
    throw new Error("Invalid question draft");
  text(q.text);
  const keys = new Set();
  for (const f of q.fields) {
    if (
      !f ||
      typeof f.key !== "string" ||
      f.key.length > 8192 ||
      keys.has(f.key) ||
      (typeof f.value !== "boolean" &&
        (typeof f.value !== "string" || f.value.length > 32768))
    )
      throw new Error("Invalid question draft field");
    keys.add(f.key);
  }
}

/** UI recovery data only. Never grants execution or approval authority. */
class DraftStore {
  constructor(root) {
    this.root = root;
    this.queue = Promise.resolve();
    this.queued = 0;
    this.queuedBytes = 0;
  }

  _serial(action, bytes = 0) {
    if (this.queued >= 64 || this.queuedBytes + bytes > 40 * 1024 * 1024)
      return Promise.reject(
        new Error("Draft storage is busy; keep the editor open and try again"),
      );
    this.queued++;
    this.queuedBytes += bytes;
    const result = this.queue.then(action);
    this.queue = result
      .catch(() => {})
      .finally(() => {
        this.queued--;
        this.queuedBytes -= bytes;
      });
    return result;
  }
  _directory(key) {
    if (!KEY.test(key)) throw new Error("Invalid draft identity");
    return path.join(this.root, key);
  }
  async _read(key) {
    const file = path.join(this._directory(key), "draft.json");
    let handle;
    try {
      const info = await fs.lstat(file);
      if (!info.isFile() || info.size > MAX_RECORD_BYTES)
        throw new Error("Invalid draft record");
      handle = await fs.open(file, "r");
      const data = Buffer.alloc(info.size + 1);
      let n = 0;
      while (n < data.length) {
        const r = await handle.read(data, n, data.length - n, n);
        if (!r.bytesRead) break;
        n += r.bytesRead;
      }
      if (n !== info.size)
        throw new Error("Draft record changed while reading");
      const record = JSON.parse(data.subarray(0, n).toString("utf8"));
      if (
        record.version !== 1 ||
        record.key !== key ||
        !record.composer ||
        !validImages(record.composer.images) ||
        !Array.isArray(record.pending) ||
        record.pending.length > 8 ||
        !Array.isArray(record.questions) ||
        record.questions.length > 16
      )
        throw new Error("Invalid draft record");
      text(record.composer.text);
      for (const q of record.questions) {
        validQuestion(q);
      }
      for (const p of record.pending) {
        text(p.text);
        if (
          !CLIENT_ID.test(p.id) ||
          typeof p.sessionId !== "string" ||
          !validImages(p.images) ||
          !["prepared", "unknown", "rejected", "accepted"].includes(p.status)
        )
          throw new Error("Invalid saved input");
      }
      return record;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return {
        version: 1,
        key,
        composer: { text: "", images: [] },
        pending: [],
        questions: [],
      };
    } finally {
      await handle?.close();
    }
  }
  async _quota(extra = 0, creatingKey = null) {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const dirs = (await fs.readdir(this.root, { withFileTypes: true })).filter(
      (e) => e.isDirectory() && KEY.test(e.name),
    );
    if (
      dirs.length > 128 ||
      (dirs.length === 128 &&
        creatingKey &&
        !dirs.some((d) => d.name === creatingKey))
    )
      throw new Error("Draft storage has reached its 128 conversation limit");
    let bytes = extra;
    for (const dir of dirs) {
      for (const entry of await fs.readdir(path.join(this.root, dir.name), {
        withFileTypes: true,
      })) {
        if (!entry.isFile()) continue;
        bytes += (await fs.stat(path.join(this.root, dir.name, entry.name)))
          .size;
        if (bytes > MAX_STORAGE_BYTES)
          throw new Error(
            "Draft storage exceeds 100 MiB; discard old saved inputs before adding images",
          );
      }
    }
  }
  async _images(key, images) {
    checkImageEnvelope(images);
    await this._quota(
      images.reduce((n, i) => n + i.data.length * 0.75, 0),
      key,
    );
    const directory = this._directory(key);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const files = await writeImageTemps(images, { directory });
    const metadata = [];
    try {
      for (const file of files) {
        const data = await readImageSnapshot(file);
        const ext = path.extname(file).slice(1);
        metadata.push({
          file: path.basename(file),
          size: data.length,
          hash: hash(data),
          mime: `image/${ext === "jpg" ? "jpeg" : ext}`,
        });
      }
      return metadata;
    } catch (error) {
      await Promise.allSettled(files.map((file) => fs.unlink(file)));
      throw error;
    }
  }
  async _write(record) {
    const directory = this._directory(record.key);
    if (
      !record.composer.text &&
      !record.composer.images.length &&
      !record.pending.length &&
      !record.questions.length
    ) {
      for (const name of await fs.readdir(directory).catch(() => [])) {
        if (name === "draft.json" || IMAGE_NAME.test(name))
          await fs.unlink(path.join(directory, name));
      }
      await fs.rmdir(directory).catch(() => {});
      return;
    }
    const data = JSON.stringify(record);
    if (Buffer.byteLength(data) > MAX_RECORD_BYTES)
      throw new Error("Draft metadata exceeds its storage limit");
    const oldSize = await fs.stat(path.join(directory, "draft.json")).then(
      (s) => s.size,
      (error) => {
        if (error.code === "ENOENT") return 0;
        throw error;
      },
    );
    await this._quota(
      Math.max(0, Buffer.byteLength(data) - oldSize),
      record.key,
    );
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `${crypto.randomUUID()}.tmp`);
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, path.join(directory, "draft.json"));
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
    // Only delete unreferenced owned images, after publishing the new manifest.
    const keep = new Set(
      [
        ...record.composer.images,
        ...record.pending.flatMap((p) => p.images),
      ].map((i) => i.file),
    );
    for (const name of await fs.readdir(directory).catch(() => [])) {
      if (IMAGE_NAME.test(name) && !keep.has(name))
        await fs.unlink(path.join(directory, name)).catch(() => {});
    }
  }
  async _payload(key, snapshot) {
    const images = [];
    for (const meta of snapshot.images) {
      const file = path.join(this._directory(key), meta.file);
      const data = await readImageSnapshot(file, meta.size);
      if (data.length !== meta.size || hash(data) !== meta.hash)
        throw new Error(
          "Saved attachment is missing or changed; attach it again",
        );
      images.push({
        data: `data:${meta.mime};base64,${data.toString("base64")}`,
        size: data.length,
      });
    }
    return { text: snapshot.text, images };
  }
  save(key, draft) {
    if (draft.images !== undefined) checkImageEnvelope(draft.images);
    return this._serial(
      async () => {
        const record = await this._read(key);
        const next = { text: text(draft.text), images: record.composer.images };
        if (draft.images !== undefined)
          next.images = await this._images(key, draft.images);
        record.composer = next;
        record.sessionId = draft.sessionId || record.sessionId || null;
        try {
          await this._write(record);
        } catch (error) {
          if (draft.images !== undefined)
            await this._removeImages(key, next.images);
          throw error;
        }
      },
      (draft.images || []).reduce((n, i) => n + i.data.length, 0),
    );
  }
  prepare(key, sessionId, id, draft) {
    checkImageEnvelope(draft.images || []);
    return this._serial(
      async () => {
        if (!CLIENT_ID.test(id) || !sessionId)
          throw new Error("Invalid submission identity");
        const record = await this._read(key);
        if (record.pending.some((p) => p.id === id))
          throw new Error(
            "This input already has a saved submission; inspect its acceptance first",
          );
        record.pending = record.pending.filter((p) => p.status !== "accepted");
        if (record.pending.length >= 8)
          throw new Error(
            "Resolve the eight saved submissions before sending more input",
          );
        const input = {
          id,
          sessionId,
          text: text(draft.text),
          images: await this._images(key, draft.images || []),
          status: "prepared",
        };
        record.pending.push(input);
        record.sessionId = sessionId;
        record.composer = { text: "", images: [] };
        try {
          await this._write(record);
        } catch (error) {
          await this._removeImages(key, input.images);
          throw error;
        }
        return {
          ...input,
          paths: input.images.map((i) =>
            path.join(this._directory(key), i.file),
          ),
        };
      },
      (draft.images || []).reduce((n, i) => n + i.data.length, 0),
    );
  }
  async _removeImages(key, images) {
    await Promise.allSettled(
      images
        .filter((i) => IMAGE_NAME.test(i.file))
        .map((i) => fs.unlink(path.join(this._directory(key), i.file))),
    );
  }
  settle(key, id, status, receipt = null) {
    return this._serial(async () => {
      const record = await this._read(key);
      const input = record.pending.find((p) => p.id === id);
      if (!input || input.status === "accepted") return;
      if (!["unknown", "rejected", "accepted"].includes(status))
        throw new Error("Invalid acceptance status");
      if (status === "accepted") {
        if (
          receipt?.sessionId !== input.sessionId ||
          receipt?.clientMessageId !== id ||
          !/^[a-f0-9]{64}$/.test(receipt.eventHash || "") ||
          !/^[a-f0-9]{64}$/.test(receipt.inputDigest || "")
        )
          throw new Error("Input receipt does not match saved submission");
        input.receipt = receipt;
        input.images = [];
      }
      input.status = status;
      await this._write(record);
    });
  }
  view(key, { includeComposer = true } = {}) {
    return this._serial(async () => {
      const record = await this._read(key);
      let composer;
      try {
        if (includeComposer)
          composer = await this._payload(key, record.composer);
      } catch (error) {
        composer = {
          text: record.composer.text,
          images: [],
          missingImages: true,
          error: error.message,
        };
      }
      return {
        composer,
        pending: record.pending.map(({ images, ...p }) => ({
          ...p,
          imageCount: images.length,
        })),
        questions: record.questions,
      };
    });
  }
  recover(key, id) {
    return this._serial(async () => {
      const record = await this._read(key);
      const input = record.pending.find((p) => p.id === id);
      if (!input || input.status === "accepted")
        throw new Error("Accepted input cannot be restored for resubmission");
      return this._payload(key, input); // explicit editable copy; never sends it
    });
  }
  discard(key, id) {
    return this._serial(async () => {
      const record = await this._read(key);
      record.pending = record.pending.filter((p) => p.id !== id);
      await this._write(record);
    });
  }
  saveQuestion(key, question) {
    validQuestion(question);
    return this._serial(async () => {
      if (
        !KEY.test(question.id) ||
        !/^[a-f0-9]{64}$/.test(question.digest || "") ||
        Buffer.byteLength(JSON.stringify(question)) > 128 * 1024
      )
        throw new Error("Invalid or oversized question draft");
      const record = await this._read(key);
      const old = record.questions.find((q) => q.id === question.id);
      if (old && old.digest !== question.digest)
        throw new Error("Question draft identity changed");
      if (!old && record.questions.length >= 16)
        throw new Error(
          "Discard an old question draft before saving more than 16 questions",
        );
      record.questions = record.questions.filter((q) => q.id !== question.id);
      record.questions.push({
        ...question,
        status: old?.status === "archived" ? "archived" : question.status,
      });
      record.sessionId ||= question.sessionId;
      await this._write(record);
    });
  }
  archiveQuestion(key, id, digest = null) {
    return this._serial(async () => {
      const record = await this._read(key);
      const found = record.questions.filter(
        (q) => q.id === id || (digest && q.digest === digest),
      );
      if (found.length) {
        for (const q of found) q.status = "archived";
        await this._write(record);
      }
    });
  }
  discardQuestion(key, id) {
    return this._serial(async () => {
      const record = await this._read(key);
      record.questions = record.questions.filter((q) => q.id !== id);
      await this._write(record);
    });
  }
  list() {
    return this._serial(async () => {
      const entries = await fs
        .readdir(this.root, { withFileTypes: true })
        .catch((error) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
      const result = [];
      for (const entry of entries
        .filter((e) => e.isDirectory() && KEY.test(e.name))
        .slice(0, 128)) {
        const record = await this._read(entry.name);
        if (
          !record.composer.text &&
          !record.composer.images.length &&
          !record.pending.length &&
          !record.questions.length
        )
          continue;
        result.push({
          key: entry.name,
          sessionId: record.sessionId || record.pending[0]?.sessionId || null,
          label: (
            record.composer.text ||
            record.pending[0]?.text ||
            record.questions[0]?.title ||
            "Image draft"
          ).slice(0, 100),
          description: `${record.pending.length} saved submissions`,
        });
      }
      return result;
    });
  }
}
module.exports = { DraftStore };
