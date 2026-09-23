const { ZodError } = require("zod");
const { HttpError } = require("../lib/http");

function notFoundHandler(req, res) {
  res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}`, code: "NOT_FOUND" });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const first = issues[0];
    return res.status(400).json({
      error: first ? `${first.path || "request"}: ${first.message}` : "Invalid request.",
      code: "VALIDATION",
      issues,
    });
  }
  if (err && err.code === "P2002") {
    return res.status(409).json({ error: "That record already exists.", code: "DUPLICATE" });
  }
  if (err && err.code === "P2025") {
    return res.status(404).json({ error: "Record not found.", code: "NOT_FOUND" });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body is not valid JSON.", code: "BAD_JSON" });
  }
  console.error(err);
  return res.status(500).json({ error: "Something went wrong on the server.", code: "SERVER_ERROR" });
}

module.exports = { notFoundHandler, errorHandler };
