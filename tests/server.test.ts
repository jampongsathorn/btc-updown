import { describe, it, expect } from "vitest";
import { createServer } from "../src/server";
import { StateStore } from "../src/state";
import path from "path";
import fs from "fs";

describe("Web Preview & Relay Server", () => {
  const testFilePath = path.join(process.cwd(), "state", "test-server-live.json");
  const store = new StateStore(testFilePath);

  it("should respond to /api/tokens with active current and next token IDs", async () => {
    const app = createServer({
      port: 3000,
      stateStore: store,
      onRelayEvent: () => {},
      getActiveTokens: () => ({ current: ["up-1", "down-1"], next: ["up-2", "down-2"] }),
    });

    const server = app.listen(0);
    const address = server.address() as any;
    const port = address.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/tokens`);
    const data = await res.json();

    expect(data.current).toEqual(["up-1", "down-1"]);
    expect(data.next).toEqual(["up-2", "down-2"]);

    server.close();
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  });
});
