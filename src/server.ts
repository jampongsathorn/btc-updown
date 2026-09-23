import express from "express";
import path from "path";
import { StateStore } from "./state.js";
import { TransportNormalizer, NormalizedEvent } from "./transport.js";
import { DiscordWebhookPayload } from "./alerts.js";

export const DISCORD_WEBHOOK_URL =
  process.env.DISCORD_WEBHOOK_URL ||
  "https://discord.com/api/webhooks/1552315113535578144/AuLKFz6d6-pRMPk78UYkKL5BmTJuU6zdZDqdwI8GtBgtwJOX2vWfZ9WQtqhBRSNnhk_7";

export interface PendingAlert {
  id: string;
  timestamp: number;
  payload: DiscordWebhookPayload;
}

export interface ServerOptions {
  port: number;
  stateStore: StateStore;
  onRelayEvent: (event: NormalizedEvent) => void;
  getActiveTokens: () => { current: string[]; next: string[] };
  setTokenIds?: (current: { up: string; down: string }, next?: { up: string; down: string }) => void;
  setSpotPrices?: (spot: number, priceToBeat?: number) => void;
  getLatestFlightSummary?: () => any;
  emitAlert?: (payload: DiscordWebhookPayload) => void;
}

export function createServer(options: ServerOptions) {
  const app = express();
  const normalizer = new TransportNormalizer();

  const pendingAlerts: PendingAlert[] = [];
  const alertHistory: PendingAlert[] = [];

  // Expose emitAlert so engine can push alerts
  options.emitAlert = (payload: DiscordWebhookPayload) => {
    const alert: PendingAlert = {
      id: `alert-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      payload,
    };
    pendingAlerts.push(alert);
    alertHistory.unshift(alert);
    if (alertHistory.length > 50) alertHistory.pop();

    // Dual-dispatch: On real VPS/EC2, send directly from Node.js background worker
    if (DISCORD_WEBHOOK_URL) {
      fetch(DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((res) => {
        if (res.ok) {
          // Remove from pending since Node.js delivered it directly
          const idx = pendingAlerts.findIndex((a) => a.id === alert.id);
          if (idx !== -1) pendingAlerts.splice(idx, 1);
        }
      }).catch(() => {
        // Fallback: remains in pendingAlerts for browser relay if direct fetch is blocked
      });
    }
  };

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

  app.get("/api/alerts/config", (_req, res) => {
    res.json({ webhookUrl: DISCORD_WEBHOOK_URL });
  });

  app.get("/api/alerts/pending", (_req, res) => {
    res.json(pendingAlerts);
  });

  app.post("/api/alerts/ack", (req, res) => {
    const { id } = req.body;
    const idx = pendingAlerts.findIndex(a => a.id === id);
    if (idx !== -1) {
      pendingAlerts.splice(idx, 1);
    }
    res.json({ ok: true });
  });

  app.get("/api/alerts/history", (_req, res) => {
    res.json(alertHistory);
  });

  app.post("/api/alerts/test", (_req, res) => {
    if (options.emitAlert) {
      options.emitAlert({
        username: "Polymarket 5m Quant Sniper",
        embeds: [
          {
            title: "🟢 DISCORD WEBHOOK TEST: QUANT ALERT SYSTEM ACTIVE",
            color: 0x10B981,
            description: "System alert channel established successfully! In/Out/PnL notifications will stream here live.",
            timestamp: new Date().toISOString(),
          }
        ]
      });
    }
    res.json({ ok: true });
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
