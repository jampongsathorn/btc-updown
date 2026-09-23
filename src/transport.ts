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
  public parseRawMessage(data: string | Buffer): NormalizedEvent | null {
    const text = data.toString().trim();
    if (text === "PONG" || text === "PING" || !text.startsWith("{")) {
      return null;
    }

    try {
      const parsed = JSON.parse(text);
      const eventType = parsed.event_type || parsed.type;
      const assetId = parsed.asset_id || (parsed.assets_ids && parsed.assets_ids[0]) || "";

      if (eventType === "book") {
        return {
          type: "book",
          assetId,
          bids: parsed.bids || [],
          asks: parsed.asks || [],
          timestamp: parsed.timestamp ? parseInt(parsed.timestamp, 10) : Date.now(),
        };
      }

      if (eventType === "price_change") {
        const changes: PriceChange[] = (parsed.price_changes || []).map((ch: any) => ({
          side: ch.side,
          price: ch.price,
          size: ch.size,
        }));
        return {
          type: "price_change",
          assetId,
          priceChanges: changes,
          timestamp: Date.now(),
        };
      }

      if (eventType === "last_trade_price") {
        return {
          type: "last_trade_price",
          assetId,
          lastTradePrice: parseFloat(parsed.price),
          timestamp: Date.now(),
        };
      }

      return null;
    } catch {
      return null;
    }
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
        const normalized = this.normalizer.parseRawMessage(data as Buffer);
        if (normalized) {
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
