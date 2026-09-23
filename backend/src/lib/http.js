class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || undefined;
  }
}

const badRequest = (msg, code) => new HttpError(400, msg, code);
const forbidden = (msg = "You do not have access to this.") => new HttpError(403, msg, "FORBIDDEN");
const notFound = (what = "Resource") => new HttpError(404, `${what} not found.`, "NOT_FOUND");
const conflict = (msg, code) => new HttpError(409, msg, code);

/** Parse a positive integer route param or throw 400. */
function idParam(value, name = "id") {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${name}.`);
  return n;
}

module.exports = { HttpError, badRequest, forbidden, notFound, conflict, idParam };
