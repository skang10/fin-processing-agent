import { PostgresCaseCommandService, PostgresCaseQueryService, createDatabase } from "@findoc/persistence";
import { buildApp } from "./app.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const { client, db } = createDatabase(databaseUrl);
const app = buildApp(
  new PostgresCaseCommandService(db, "local_demo_submitter"),
  new PostgresCaseQueryService(db),
);
app.addHook("onClose", async () => client.end());

await app.listen({ host: "127.0.0.1", port: 3000 });
