/**
 * Discord Webhook & In/Out/PnL Alert Formatter
 */

export interface DiscordEmbed {
  title: string;
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
  reason: string;
}

export interface SettlementAlertData {
  slotEpoch: number;
  slug: string;
  won: boolean;
  side: "UP" | "DOWN";
  finalPrice: number;
  strikePrice: number;
  netPnlUsd: number;
  returnPct: number;
  totalBankrollUsd: number;
  winRatePct: number;
  wins: number;
  losses: number;
}

export function formatEntryAlert(data: EntryAlertData): DiscordWebhookPayload {
  const isUp = data.side === "UP";
  const icon = isUp ? "🟢 ▲" : "🔴 ▼";
  const color = isUp ? 0x10B981 : 0xEF4444; // Green or Red
  const delta = data.spotPrice - data.strikePrice;
  const deltaStr = (delta >= 0 ? "+" : "") + delta.toFixed(2);

  return {
    username: "Polymarket 5m Quant Sniper",
    embeds: [
      {
        title: `${icon} ENTRY SIGNAL: BUY ${data.side} [${data.slug.slice(11)}]`,
        color,
        description:
          `**Quantitative Model detected statistical edge in Sniper Window!**\n\n` +
          `• **Target Token:** \`${data.side}\` @ **$${data.entryPrice.toFixed(2)}**\n` +
          `• **Win Probability (p*):** **${(data.trueProbability * 100).toFixed(1)}%**\n` +
          `• **Net Expected Value (EV):** **+$${data.expectedValueUsd.toFixed(3)}** / share (+${data.netRoiPct}% ROI)\n` +
          `• **Current BTC Spot:** **$${data.spotPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}** (Strike: $${data.strikePrice.toLocaleString("en-US", { minimumFractionDigits: 2 })})\n` +
          `• **Drift Distance:** **${deltaStr} USD**\n` +
          `• **Order Sizing:** **${data.shares} shares** (Cost Basis: $${data.totalCostUsd.toFixed(2)} USD)\n` +
          `• **Time Remaining:** **${data.secondsRemaining}s** before resolution\n` +
          `• **Annualized Realized Vol:** **${((data.realizedVol ?? 0.55) * 100).toFixed(1)}%**`,
        timestamp: new Date().toISOString(),
        footer: { text: "Polymarket BTC UpDown 5m Engine • Fail-Closed Guard Active" },
      },
    ],
  };
}

export function formatStopLossAlert(data: StopLossAlertData): DiscordWebhookPayload {
  return {
    username: "Polymarket 5m Quant Sniper",
    embeds: [
      {
        title: `🛡️ STOP-LOSS EXIT: LIQUIDATED EARLY [${data.slug.slice(11)}]`,
        color: 0xFE8761, // Highlight Orange (#FE8761)
        description:
          `**Dynamic Stop-Loss triggered early exit to preserve capital!**\n\n` +
          `• **Position Liquidated:** \`${data.side}\` (${data.shares} shares)\n` +
          `• **Entry Price vs Exit Bid:** $${data.entryPrice.toFixed(2)} ➔ **$${data.exitBidPrice.toFixed(2)}**\n` +
          `• **Trigger Reason:** ${data.reason}\n` +
          `• **Loss Capped At:** **-$${data.lossCappedUsd.toFixed(2)} USD** (avoided $0.00 total wipeout)\n` +
          `• **Capital Preserved:** **+${data.capitalPreservedPct.toFixed(1)}% of capital saved!**`,
        timestamp: new Date().toISOString(),
        footer: { text: "Capital Preservation Guard • Risk Mitigated" },
      },
    ],
  };
}

export function formatSettlementAlert(data: SettlementAlertData): DiscordWebhookPayload {
  const isWin = data.won;
  const icon = isWin ? "🏆" : "⚠️";
  const title = isWin ? "MARKET SETTLED: WIN" : "MARKET SETTLED: LOSS";
  const color = isWin ? 0x3B82F6 : 0xEF4444; // Blue or Red
  const pnlStr = (data.netPnlUsd >= 0 ? "+" : "") + `$${data.netPnlUsd.toFixed(2)}`;

  return {
    username: "Polymarket 5m Quant Sniper",
    embeds: [
      {
        title: `${icon} ${title} [${data.slug.slice(11)}]`,
        color,
        description:
          `**5-Minute Market Round Resolved & Settled!**\n\n` +
          `• **Resolution Outcome:** **${data.side}**\n` +
          `• **Final Chainlink TWAP:** **$${data.finalPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}** (Strike: $${data.strikePrice.toLocaleString("en-US", { minimumFractionDigits: 2 })})\n` +
          `• **Net Round PnL:** **${pnlStr} USD** (${data.returnPct >= 0 ? "+" : ""}${data.returnPct}%)\n` +
          `• **Total Virtual Bankroll:** **$${data.totalBankrollUsd.toFixed(2)} USD**\n` +
          `• **Cumulative Win Rate:** **${data.winRatePct.toFixed(1)}%** (${data.wins}W - ${data.losses}L)`,
        timestamp: new Date().toISOString(),
        footer: { text: "Settlement Complete • Auto-Rolling Next Slot" },
      },
    ],
  };
}
