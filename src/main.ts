import { serve } from "@hono/node-server";
import { createApp } from "./app";

const app = createApp();
const port = parseInt(process.env.PORT || "3000");

serve(
  {
    fetch: app.fetch,
    port,
  },
  () => {}
);
