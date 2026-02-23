const fs = require("fs");
const E = "utf8";
const B = "C:/code/chainlesschain/desktop-app-vue/src/main/ukey";
const w = (f, c) => {
  fs.writeFileSync(B + "/" + f, c, E);
  console.log(f, "written", c.length, "bytes");
};
