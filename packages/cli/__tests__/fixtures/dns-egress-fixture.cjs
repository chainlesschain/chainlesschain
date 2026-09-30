// A real DNS A exchange over UDP or TCP. The same client bytes are used by
// host positive controls and the Docker target; no external DNS is involved.
const crypto = require("node:crypto");
const dgram = require("node:dgram");
const net = require("node:net");

function createQuery(name, queryId = crypto.randomInt(0x10000)) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(queryId, 0);
  header.writeUInt16BE(0x0100, 2);
  header.writeUInt16BE(1, 4);
  const labels = name.split(".").map((label) => {
    const bytes = Buffer.from(label, "ascii");
    if (!bytes.length || bytes.length > 63)
      throw new Error("Invalid DNS label");
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  });
  return Buffer.concat([header, ...labels, Buffer.from([0, 0, 1, 0, 1])]);
}

function createAnswer(query) {
  const header = Buffer.from(query.subarray(0, 12));
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(1, 6);
  return Buffer.concat([
    header,
    query.subarray(12),
    Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 0, 0, 4, 127, 0, 0, 9]),
  ]);
}

function frame(message) {
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16BE(message.length);
  return Buffer.concat([prefix, message]);
}

function queryDns({
  transport,
  family,
  host,
  port,
  name,
  queryId,
  timeoutMs = 1500,
}) {
  const query = createQuery(name, queryId);
  return new Promise((resolve, reject) => {
    const socket =
      transport === "udp"
        ? dgram.createSocket(family === 6 ? "udp6" : "udp4")
        : net.connect({ host, port, family });
    let settled = false;
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (transport === "udp") {
        try {
          socket.close();
        } catch {
          /* send may have failed before bind */
        }
      } else socket.destroy();
      if (error) reject(error);
      else if (!response.equals(createAnswer(query)))
        reject(new Error("DNS answer mismatch"));
      else resolve(response);
    };
    const timer = setTimeout(
      () =>
        finish(
          Object.assign(new Error("DNS query timed out"), {
            code: "DNS_PROBE_TIMEOUT",
          }),
        ),
      timeoutMs,
    );
    socket.on("error", (error) => finish(error));
    if (transport === "udp") {
      socket.once("message", (response) => finish(null, response));
      try {
        socket.send(query, port, host, (error) => {
          if (error) finish(error);
        });
      } catch (error) {
        finish(error);
      }
    } else {
      let bytes = Buffer.alloc(0);
      socket.once("connect", () => socket.write(frame(query)));
      socket.on("data", (chunk) => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length > 514)
          return finish(new Error("DNS frame exceeded probe bounds"));
        if (bytes.length >= 2 && bytes.length >= bytes.readUInt16BE(0) + 2)
          finish(null, bytes.subarray(2));
      });
      socket.once("end", () => {
        if (!settled) finish(new Error("DNS frame truncated"));
      });
    }
  });
}

async function startDnsFixture({ transport, family }) {
  const host = family === 6 ? "::1" : "127.0.0.1";
  let queries = 0;
  const sockets = new Set();
  const server =
    transport === "udp"
      ? dgram.createSocket(family === 6 ? "udp6" : "udp4")
      : net.createServer((socket) => {
          sockets.add(socket);
          socket.on("error", () => {});
          socket.once("close", () => sockets.delete(socket));
          let bytes = Buffer.alloc(0);
          socket.on("data", (chunk) => {
            bytes = Buffer.concat([bytes, chunk]);
            if (bytes.length > 514) return socket.destroy();
            if (
              bytes.length >= 2 &&
              bytes.length === bytes.readUInt16BE(0) + 2
            ) {
              queries += 1;
              socket.end(frame(createAnswer(bytes.subarray(2))));
            }
          });
        });
  if (transport === "udp") {
    server.on("message", (query, peer) => {
      queries += 1;
      server.send(createAnswer(query), peer.port, peer.address);
    });
  }
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    if (transport === "udp") server.bind(0, host, resolve);
    else server.listen({ port: 0, host, ipv6Only: family === 6 }, resolve);
  });
  return {
    transport,
    family,
    host,
    port: server.address().port,
    get queries() {
      return queries;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { queryDns, startDnsFixture };
