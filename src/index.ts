import { SQL } from "bun";
import { Elysia } from "elysia";

const sql = new SQL({
  adapter: "postgres",
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
});

async function prepareDatabase() {
  const result = await sql`
        CREATE TABLE IF NOT EXISTS events (
            id SERIAL PRIMARY KEY,
            event_data JSONB NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `;

  console.log("Database prepared:", result);
}

const app = new Elysia()
  .get("/events", () => {
    const result = sql`SELECT event_data FROM events ORDER BY created_at DESC LIMIT 100`;
    return result;
  })
  .get("/events/download", async ({ headers }) => {
    const result = await sql<{ event_data: unknown }[]>`SELECT event_data FROM events ORDER BY created_at DESC`;
    const jsonContent = JSON.stringify(result.map((row) => row.event_data));
    headers["Content-Disposition"] = "attachment; filename=events.json";
    headers["Content-Type"] = "application/json";
    return jsonContent;
  })
  .post("/events", async ({ body }) => {
    const result = await sql`INSERT INTO events (event_data) VALUES (${body}) RETURNING id`;
    return result;
  })
  .listen(3000, async () => {
    await prepareDatabase();
  });

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
