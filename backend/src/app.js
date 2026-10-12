const express = require("express");
const fs = require("fs");
const path = require("path");
const { prisma } = require("./db");
const { notFoundHandler, errorHandler } = require("./middleware/errors");

const app = express();
app.disable("x-powered-by");
// Stripe signs the raw webhook body, so that one route must skip JSON parsing.
app.use("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }));
app.use(express.json({ limit: "100kb" }));

const api = express.Router();
api.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok" });
});
api.get("/openapi.yaml", (_req, res) => res.sendFile(path.join(__dirname, "..", "openapi.yaml")));
api.use(require("./routes/auth"));
api.use(require("./routes/users"));
api.use(require("./routes/stages"));
api.use(require("./routes/swimmers"));
api.use(require("./routes/lessons"));
api.use(require("./routes/templates"));
api.use(require("./routes/enrollments"));
api.use(require("./routes/invoices"));
api.use(require("./routes/reports"));
api.use(require("./routes/stripe"));
api.use(notFoundHandler);

app.use("/api", api);

// In production the backend also serves the built React app (frontend/dist).
const dist = path.join(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use(errorHandler);

module.exports = app;
