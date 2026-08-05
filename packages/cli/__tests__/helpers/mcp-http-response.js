export function textByteStream(text = "") {
  const bytes = new TextEncoder().encode(String(text));
  let consumed = false;
  let cancelled = false;
  return {
    async cancel() {
      cancelled = true;
    },
    getReader() {
      return {
        async read() {
          if (cancelled || consumed) return { done: true, value: undefined };
          consumed = true;
          return { done: false, value: bytes };
        },
        async cancel() {
          cancelled = true;
        },
        releaseLock() {},
      };
    },
  };
}
