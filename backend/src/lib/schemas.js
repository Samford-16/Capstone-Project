const { z } = require("zod");
const { ISO_DATE, TIME } = require("./dates");

const isoDate = z.string().regex(ISO_DATE, "must be a date like 2026-09-23");
const time = z.string().regex(TIME, "must be a 24-hour time like 16:30");
const id = z.coerce.number().int().positive();
const stageId = z.coerce.number().int().min(1).max(5);
const dayOfWeek = z.coerce.number().int().min(0).max(6);
const email = z.string().trim().toLowerCase().email();
const password = z.string().min(8, "must be at least 8 characters").max(200);
const name = z.string().trim().min(1).max(120);

const swimmerInput = z.object({
  firstName: name,
  lastName: name,
  dateOfBirth: isoDate.optional().nullable(),
  stageId: stageId.optional().nullable(),
});

const lessonFields = {
  name: z.string().trim().max(120).optional().nullable(),
  stageId,
  coachId: id.optional().nullable(),
  dayOfWeek,
  startTime: time,
  endTime: time,
  capacity: z.coerce.number().int().min(1).max(100),
  location: z.string().trim().max(120).optional().nullable(),
};

module.exports = { z, isoDate, time, id, stageId, dayOfWeek, email, password, name, swimmerInput, lessonFields };
