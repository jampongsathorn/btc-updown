import WebSocket from "ws";
import { BookLevel, PriceChange } from "./orderbook.js";

export interface NormalizedEvent {
  type: "book" | "price_change" | "last_trade_price" | "tick_size_change" | "unknown";
  assetId: string;
  bids?: BookLevel[];
  asks?: BookLevel[];
  priceChanges?: PriceChange[];
  lastTradePrice?: number;
  timestamp?: number;
}

export class TransportNormalizer {
  /**
   * Returns an array because a single raw WS frame can carry events for
   * MULTIPLE assets at once - confirmed 2026-09-23 by capturing real
   * messages from wss://ws-subscriptions-clob.polymarket.com/ws/market:
   *
   * - The initial "book" snapshot sent right after subscribing arrives as a
   *   JSON ARRAY, one object per subscribed asset (e.g. `[{event_type:
   *   "book", asset_id: "...UP", ...}, {event_type: "book", asset_id:
   *   "...DOWN", ...}]`) - NOT a single object. The old single-event parser
   *   called `.event_type` on the array itself (undefined) and silently
   *   dropped the whole snapshot for every asset, every time.
   * - "price_change" messages have NO top-level asset_id at all - each
   *   entry in `price_changes[]` carries its own `asset_id`, since one
   *   message batches simultaneous changes across both the UP and DOWN
   *   token (e.g. a buy on one side moves both). The old parser looked for
   *   a top-level asset_id, got "", and every incremental price update was
   *   silently dropped for both tokens - the engine's orderbook only ever
   *   reflected the one-time initial snapshot state (when that even got
   *   through), never a live price.
   */
  public parseRawMessage(data: string | Buffer): NormalizedEvent[] {
    const text = data.toString().trim();
    if (text === "PONG" || text === "PING" || (!text.startsWith("{") && !text.startsWith("["))) {
      return [];
    }

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.flatMap((item) => this.parseOne(item));
      }
      return this.parseOne(parsed);
    } catch {
      return [];
    }
  }

  private parseOne(parsed: any): NormalizedEvent[] {
    const eventType = parsed.event_type || parsed.type;

    if (eventType === "book") {
      const assetId = parsed.asset_id || (parsed.assets_ids && parsed.assets_ids[0]) || "";
      return [{
        type: "book",
        assetId,
        bids: parsed.bids || [],
        asks: parsed.asks || [],
        timestamp: parsed.timestamp ? parseInt(parsed.timestamp, 10) : Date.now(),
      }];
    }

    if (eventType === "price_change") {
      const entries: any[] = parsed.price_changes || [];
      const byAsset = new Map<string, PriceChange[]>();
      for (const ch of entries) {
        const assetId = ch.asset_id || parsed.asset_id || "";
        if (!assetId) continue;
        if (!byAsset.has(assetId)) byAsset.set(assetId, []);
        byAsset.get(assetId)!.push({ side: ch.side, price: ch.price, size: ch.size });
      }
      return Array.from(byAsset.entries()).map(([assetId, priceChanges]) => ({
        type: "price_change" as const,
        assetId,
        priceChanges,
        timestamp: Date.now(),
      }));
    }

    if (eventType === "last_trade_price") {
      return [{
        type: "last_trade_price",
        assetId: parsed.asset_id || "",
        lastTradePrice: parseFloat(parsed.price),
        timestamp: Date.now(),
      }];
    }

    return [];
  }
}

export interface NodeWsClientOptions {
  wsUrl?: string;
  onEvent: (event: NormalizedEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export class NodeWsClient {
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private normalizer = new TransportNormalizer();
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private activeSubscriptions: Set<string> = new Set();
  private isConnected = false;
  private closedByUser = false;

  constructor(private options: NodeWsClientOptions) {
    this.wsUrl = options.wsUrl || "wss://ws-subscriptions-clob.polymarket.com/ws/market";
  }

  public connect(): void {
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on("open", () => {
        this.isConnected = true;
        this.options.onConnect?.();

        if (this.activeSubscriptions.size > 0) {
          this.subscribe(Array.from(this.activeSubscriptions));
        }

        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send("PING");
          }
        }, 10000);
      });

      this.ws.on("message", (data) => {
        const normalizedEvents = this.normalizer.parseRawMessage(data as Buffer);
        for (const normalized of normalizedEvents) {
          this.options.onEvent(normalized);
        }
      });

      this.ws.on("close", () => {
        this.handleDisconnect();
      });

      this.ws.on("error", () => {
        this.handleDisconnect();
      });
    } catch {
      this.handleDisconnect();
    }
  }

  private handleDisconnect(): void {
    this.isConnected = false;
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.options.onDisconnect?.();

    if (!this.closedByUser && !this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 3000);
    }
  }

  public subscribe(assetIds: string[]): void {
    for (const id of assetIds) this.activeSubscriptions.add(id);
    if (this.ws && this.ws.readyState === WebSocket.OPEN && assetIds.length > 0) {
      this.ws.send(JSON.stringify({
        type: "market",
        assets_ids: assetIds,
        custom_feature_enabled: true,
      }));
    }
  }

  public unsubscribe(assetIds: string[]): void {
    for (const id of assetIds) this.activeSubscriptions.delete(id);
    if (this.ws && this.ws.readyState === WebSocket.OPEN && assetIds.length > 0) {
      this.ws.send(JSON.stringify({
        operation: "unsubscribe",
        assets_ids: assetIds,
      }));
    }
  }

  public getConnected(): boolean {
    return this.isConnected;
  }

  public close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}
