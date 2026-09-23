/**
 * Discord Webhook & In/Out/PnL Alert Formatter
 * Formats institutional alerts for Discord Webhooks and UI Banner
 */

export interface DiscordEmbed {
  title: string;
  url?: string;
  description: string;
  color: number;
  timestamp?: string;
  footer?: { text: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface DiscordWebhookPayload {
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds: DiscordEmbed[];
}

export interface EntryAlertData {
  slotEpoch: number;
  slug: string;
  side: "UP" | "DOWN";
  strikePrice: number;
  spotPrice: number;
  trueProbability: number;
  expectedValueUsd: number;
  netRoiPct: number;
  entryPrice: number;
  shares: number;
  totalCostUsd: number;
  realizedVol?: number;
  secondsRemaining: number;
  reason?: string;
}

export interface StopLossAlertData {
  slotEpoch: number;
  slug: string;
  side: "UP" | "DOWN";
  strikePrice: number;
  currentSpot: number;
  entryPrice: number;
  exitBidPrice: number;
  shares: number;
  lossCappedUsd: number;
  capitalPreservedPct: number;
  lossPct?: number;
  reason: string;
}

export interface SettlementAlertData {
  slotEpoch: number;
  slug: string;
  won: boolean;
  side: "UP" | "DOWN";
  entryPrice?: number;
  exitPrice?: number;
  finalPrice: number;
  strikePrice: number;
  netPnlUsd: number;
  returnPct: number;
  totalBankrollUsd: number;
  winRatePct: number;
  wins: number;
  losses: number;
  reason?: string;
}

/**
 * 1. SIGNAL IN Alert
 * Requirements:
 *  1. link to slug
 *  2. amount (shares & cost basis USD)
 *  3. bucket + price (e.g. UP @ $0.88)
 *  4. reason (statistical edge, variance collapse, EV, buffer)
 */
export function formatEntryAlert(data: EntryAlertData): DiscordWebhookPayload {
  const isUp = data.side === "UP";
  const icon = isUp ? "🟢 ▲" : "🔴 ▼";
  const color = isUp ? 0x10B981 : 0xEF4444; // Green for UP, Red for DOWN
  const delta = data.spotPrice - data.strikePrice;
  const deltaSign = delta >= 0 ? "+" : "";
  const marketUrl = `https://polymarket.com/event/${data.slug}`;

  const reasonText =
    data.reason ||
    `Sniper window active (${data.secondsRemaining}s left) • Model Win Probability ${(data.trueProbability * 100).toFixed(1)}% • Expected Value +$${data.expectedValueUsd.toFixed(3)}/share (+${data.netRoiPct.toFixed(1)}% ROI) • Drift ${deltaSign}$${delta.toFixed(2)} USD safely exceeding $35.00 flash-wick buffer`;

  return {
    username: "Polymarket 5m Quant Sniper",
    embeds: [
      {
        title: `${icon} SIGNAL IN: BUY ${data.side} [${data.slug}]`,
        url: marketUrl,
        color,
        description:
          `**1. Market Link:** [🔗 View on Polymarket](${marketUrl})\n` +
          `**2. Amount:** **${data.shares} Shares** (~$${data.totalCostUsd.toFixed(2)} USD)\n` +
          `**3. Bucket + Price:** \`${data.side}\` @ **$${data.entryPrice.toFixed(2)}**\n` +
          `**4. Reason:** ${reasonText}`,
        fields: [
          {
            name: "📊 Win Probability (p*)",
            value: `**${(data.trueProbability * 100).toFixed(1)}%**`,
            inline: true,
          },
          {
            name: "💰 Net Expected Value",
            value: `**+$${data.expectedValueUsd.toFixed(3)}** / sh`,
            inline: true,
          },
          {
            name: "🎯 BTC Spot vs Strike",
            value: `$${data.spotPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })} (Δ ${deltaSign}$${delta.toFixed(2)})`,
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "Polymarket BTC UpDown 5m Engine • Fail-Closed Guard Active" },
      },
    ],
  };
}

/**
 * 2. STOP LOSS Alert
 * Requirements:
 *  1. link to slug
 *  2. price in , price out
 *  3. pnl dollar and %
 *  4. reason
 */
export function formatStopLossAlert(data: StopLossAlertData): DiscordWebhookPayload {
  const marketUrl = `https://polymarket.com/event/${data.slug}`;
  const lossPct =
    data.lossPct ??
    (data.entryPrice > 0 ? ((data.exitBidPrice - data.entryPrice) / data.entryPrice) * 100 : -25);

  return {
    username: "Polymarket 5m Quant Sniper",
    embeds: [
      {
        title: `🛡️ STOP LOSS: LIQUIDATED EARLY [${data.slug}]`,
        url: marketUrl,
        color: 0xFE8761, // Highlight Orange (#FE8761)
        description:
          `**1. Market Link:** [🔗 View on Polymarket](${marketUrl})\n` +
          `**2. Price IN ➔ Price OUT:** IN **$${data.entryPrice.toFixed(2)}** ➔ OUT **$${data.exitBidPrice.toFixed(2)}**\n` +
          `**3. PnL Dollar & %:** **-$${data.lossCappedUsd.toFixed(2)} USD** (**${lossPct.toFixed(1)}%**) • Capital Preserved: **+${data.capitalPreservedPct.toFixed(1)}%**\n` +
          `**4. Reason:** ${data.reason}`,
        fields: [
          {
            name: "🛡️ Position Liquidated",
            value: `\`${data.side}\` (${data.shares} shares)`,
            inline: true,
          },
          {
            name: "💵 Capital Saved",
            value: `**+${data.capitalPreservedPct.toFixed(1)}%** vs total wipeout`,
            inline: true,
          },
          {
            name: "📍 Spot At Exit",
            value: `$${data.currentSpot.toLocaleString("en-US", { minimumFractionDigits: 2 })} (Strike $${data.strikePrice.toLocaleString("en-US", { minimumFractionDigits: 2 })})`,
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "Capital Preservation Guard • Risk Mitigated" },
      },
    ],
  };
}

/**
 * 3. WIN (Settlement Profit) Alert
 * Requirements:
 *  1. link to slug
 *  2. price in , price out
 *  3. pnl dollar and %
 *  4. reason
 */
export function formatSettlementAlert(data: SettlementAlertData): DiscordWebhookPayload {
  const isWin = data.won;
  const icon = isWin ? "🏆" : "⚠️";
  const title = isWin ? "WIN: MARKET RESOLVED & SETTLED" : "MARKET SETTLED: LOSS";
  const color = isWin ? 0x22C55E : 0xEF4444; // Green for Win, Red for Loss
  const pnlSign = data.netPnlUsd >= 0 ? "+" : "";
  const pnlDollarStr = `${pnlSign}$${data.netPnlUsd.toFixed(2)} USD`;
  const pnlPctStr = `${data.returnPct >= 0 ? "+" : ""}${data.returnPct.toFixed(1)}%`;
  const marketUrl = `https://polymarket.com/event/${data.slug}`;

  const entryPrice = data.entryPrice ?? 0.88;
  const exitPrice = data.exitPrice ?? (isWin ? 1.0 : 0.0);

  const defaultReason = isWin
    ? `Slot resolved ${data.side} (Final Chainlink TWAP $${data.finalPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${data.side === "UP" ? "≥" : "<"} Strike $${data.strikePrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}) • 100% Payout redeemed at $1.00/share`
    : `Slot resolved opposite side (${data.side}) • Strike condition unfulfilled`;

  const reasonText = data.reason || defaultReason;

  return {
    username: "Polymarket 5m Quant Sniper",
    embeds: [
      {
        title: `${icon} ${title} [${data.slug}]`,
        url: marketUrl,
        color,
        description:
          `**1. Market Link:** [🔗 View on Polymarket](${marketUrl})\n` +
          `**2. Price IN ➔ Price OUT:** IN **$${entryPrice.toFixed(2)}** ➔ OUT **$${exitPrice.toFixed(2)}**\n` +
          `**3. PnL Dollar & %:** **${pnlDollarStr}** (**${pnlPctStr}**)\n` +
          `**4. Reason:** ${reasonText}`,
        fields: [
          {
            name: "🎯 Resolution Side",
            value: `**${data.side}**`,
            inline: true,
          },
          {
            name: "💼 Cumulative Bankroll",
            value: `**$${data.totalBankrollUsd.toFixed(2)} USD**`,
            inline: true,
          },
          {
            name: "📈 Cumulative Win Rate",
            value: `**${data.winRatePct.toFixed(1)}%** (${data.wins}W - ${data.losses}L)`,
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "Round Resolved • Auto-Rolling Next 5m Slot" },
      },
    ],
  };
}
