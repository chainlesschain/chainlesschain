const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const file = process.env.CC_CHILD_TRACE_FILE;
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = cp[name];
  cp[name] = function(command, ...args) {
    const started = Date.now();
    const record = (result) => {
      try {
        fs.appendFileSync(file, JSON.stringify({at:new Date().toISOString(),pid:process.pid,operation:name,command:path.basename(String(command)),elapsedMs:Date.now()-started,status:result?.status,signal:result?.signal,stack:new Error().stack.split('\n').slice(2,5)})+'\n');
      } catch {}
    };
    try {
      const result = original.call(this, command, ...args);
      if (name === 'spawn' || name === 'execFile') result.on('exit', (status, signal) => record({status,signal}));
      else record(result);
      return result;
    } catch(error) { record(error); throw error; }
  };
}
