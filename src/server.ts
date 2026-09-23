import express from "express";
import path from "path";
import { StateStore } from "./state.js";
import { TransportNormalizer, NormalizedEvent } from "./transport.js";

export interface ServerOptions {
  port: number;
  stateStore: StateStore;
  onRelayEvent: (event: NormalizedEvent) => void;
  getActiveTokens: () => { current: string[]; next: string[] };
  setTokenIds?: (current: { up: string; down: string }, next?: { up: string; down: string }) => void;
  setSpotPrices?: (spot: number, priceToBeat?: number) => void;
  getLatestFlightSummary?: () => any;
}

export function createServer(options: ServerOptions) {
  const app = express();
  const normalizer = new TransportNormalizer();

  app.use(express.json({ limit: "5mb" }));

  // Prevent browser caching so live preview updates immediately
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  });

  app.use(express.static(path.join(process.cwd(), "public"), {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    }
  }));

  app.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.sendFile(path.join(process.cwd(), "public/index.html"));
  });

  app.get("/api/state", (_req, res) => {
    const state = options.stateStore.readState();
    if (!state) {
      res.status(503).json({ error: "State not initialized yet" });
      return;
    }
    res.json(state);
  });

  app.get("/api/tokens", (_req, res) => {
    res.json(options.getActiveTokens());
  });

  app.post("/api/relay/tick", (req, res) => {
    const body = req.body;
    let normalized: NormalizedEvent | null = null;

    if (body.type && body.assetId) {
      normalized = body as NormalizedEvent;
    } else {
      normalized = normalizer.parseRawMessage(typeof body === "string" ? body : JSON.stringify(body));
    }

    if (normalized) {
      options.onRelayEvent(normalized);
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: "Unrecognized event format" });
    }
  });

  app.post("/api/tokens/register", (req, res) => {
    const { current, next } = req.body;
    if (current && current.up && current.down) {
      options.setTokenIds?.(current, next);
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: "Invalid tokens payload" });
    }
  });

  app.get("/api/flight-log/latest", (_req, res) => {
    const summary = options.getLatestFlightSummary?.();
    if (!summary) {
      res.status(404).json({ message: "No flight logs recorded yet" });
      return;
    }
    res.json(summary);
  });

  app.post("/api/spot", (req, res) => {
    const { spot, priceToBeat } = req.body;
    if (spot) {
      options.setSpotPrices?.(spot, priceToBeat || spot);
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: "Missing spot price" });
    }
  });

  app.get("/api/health", (_req, res) => {
    const state = options.stateStore.readState();
    res.json({
      status: "ok",
      canTrade: state?.safety?.canTrade ?? false,
      failClosed: state?.safety?.failClosed ?? true,
      reasons: state?.safety?.reasons ?? ["INITIALIZING"],
    });
  });

  return app;
}
