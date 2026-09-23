const config = require("./config");
const app = require("./app");
const { prisma } = require("./db");

const server = app.listen(config.port, () => {
  console.log(`[current] API listening on http://localhost:${config.port}/api`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
