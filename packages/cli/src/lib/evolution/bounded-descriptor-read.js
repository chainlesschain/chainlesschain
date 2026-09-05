const CHUNK_BYTES = 64 * 1024;

// Read exactly the already-checked size, plus one EOF probe. A concurrent
// writer cannot turn a small fstat result into an unbounded readFileSync.
// Callers still own descriptor/path identity, metadata and signature checks.
export function readBoundedDescriptor(fsImpl, descriptor, size, maximum) {
  if (
    !Number.isSafeInteger(size) ||
    !Number.isSafeInteger(maximum) ||
    size < 0 ||
    size > maximum
  ) {
    throw new Error("bounded file size is invalid");
  }
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const length = Math.min(CHUNK_BYTES, size - offset);
    const count = fsImpl.readSync(descriptor, bytes, offset, length, offset);
    if (!Number.isSafeInteger(count) || count < 1 || count > length) {
      throw new Error("file changed or ended during bounded read");
    }
    offset += count;
  }
  if (fsImpl.readSync(descriptor, Buffer.alloc(1), 0, 1, size) !== 0) {
    throw new Error("file grew during bounded read");
  }
  return bytes;
}
