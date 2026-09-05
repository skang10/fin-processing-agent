import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";

const app = buildApp({
  async accept() {
    // Temporary composition seam. PostgreSQL + outbox + pg-boss replaces this
    // before case intake is considered vertically complete.
    return { caseId: `case_${randomUUID()}`, runId: `run_${randomUUID()}` };
  },
});

await app.listen({ host: "127.0.0.1", port: 3000 });
