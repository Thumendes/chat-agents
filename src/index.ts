import { SQL } from "bun";
import { Elysia } from "elysia";
import { generateText, ModelMessage, streamText, TextPart } from "ai";

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

interface Session {
  id: string;
  status: "active" | "ended";
  messages: ModelMessage[];
  startedAt: Date;
  endedAt: Date | null;
}

const sessions = new Map<number, Session>();

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
    if (typeof body === "object" && body && "event" in body && typeof body.event === "string") {
      switch (body.event) {
        case "message_created":
          const event = body as {
            event: "message_created";
            message_type: "incoming" | "outgoing";

            sender: { id: number; name: string };
            inbox: { id: number; name: string };
            conversation: { id: number; subject: string; messages: { content: string }[] };
          };

          if (event.message_type === "incoming") {
            const content = event.conversation.messages[0]?.content;
            console.log("Received incoming message:", content);

            const session = sessions.get(event.sender.id) ?? {
              id: String(event.sender.id),
              status: "active",
              messages: [],
              startedAt: new Date(),
              endedAt: null,
            };

            session.messages.push({ role: "user", content });
            sessions.set(event.sender.id, session);

            const stream = streamText({
              model: "gpt-3.5-turbo",
              system: "You are a helpful assistant for customer support.",
              messages: session.messages,
            });

            const response = await stream.response;

            session.messages.push(...response.messages);

            const assistantMessages = response.messages.filter(
              (m) => m.role === "assistant" && (typeof m.content === "string" || m.content[0].type === "text"),
            );

            for (const message of assistantMessages) {
              const content =
                typeof message.content === "string" ? message.content : (message.content[0] as TextPart).text;

              const options = {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content, echo_id: "1234567890" }),
              };

              fetch(
                `https://chat.kapthalead.com.br/public/api/v1/inboxes/${event.inbox.id}/contacts/${event.sender.id}/conversations/${event.conversation.id}/messages`,
                options,
              )
                .then((res) => res.json())
                .then((res) => console.log(res))
                .catch((err) => console.error(err));
            }
          }
      }
    }
    // it's already in the correct format    }

    const result = await sql`INSERT INTO events (event_data) VALUES (${body}) RETURNING id`;
    return result;
  })
  .listen(3000, async () => {
    await prepareDatabase();
  });

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
