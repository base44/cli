const { writeFileSync } = require("node:fs");

writeFileSync("frontend.pid", String(process.pid));
console.log("FRONTEND_PID=" + process.pid);
setInterval(() => {}, 1000);
