export interface SlotInfo {
  epoch: number;
  slug: string;
  title: string;
  secondsRemaining: number;
  progressPct: number;
  warmupPhase: boolean;
}

export interface SlotSchedulerOptions {
  warmupSeconds?: number;
}

export interface SlotEventCallbacks {
  onWarmup?: (nextSlot: SlotInfo) => void;
  onRollover?: (newCurrentSlot: SlotInfo) => void;
}

export class SlotScheduler {
  private warmupSeconds: number;
  private lastSlotEpoch: number = 0;
  private warmupFiredForSlot: number = 0;

  constructor(options?: SlotSchedulerOptions) {
    this.warmupSeconds = options?.warmupSeconds ?? 45;
  }

  public getCurrentSlot(nowMs: number = Date.now()): SlotInfo {
    const nowSec = Math.floor(nowMs / 1000);
    const epoch = Math.floor(nowSec / 300) * 300;
    const elapsed = nowSec - epoch;
    const secondsRemaining = Math.max(0, 300 - elapsed);
    const progressPct = parseFloat(((elapsed / 300) * 100).toFixed(1));
    const warmupPhase = secondsRemaining <= this.warmupSeconds;

    return {
      epoch,
      slug: `btc-updown-5m-${epoch}`,
      title: `Bitcoin Up or Down 5m (${new Date(epoch * 1000).toISOString()})`,
      secondsRemaining,
      progressPct,
      warmupPhase,
    };
  }

  public getNextSlot(nowMs: number = Date.now()): SlotInfo {
    const current = this.getCurrentSlot(nowMs);
    const nextEpoch = current.epoch + 300;
    return {
      epoch: nextEpoch,
      slug: `btc-updown-5m-${nextEpoch}`,
      title: `Bitcoin Up or Down 5m (${new Date(nextEpoch * 1000).toISOString()})`,
      secondsRemaining: current.secondsRemaining + 300,
      progressPct: 0,
      warmupPhase: false,
    };
  }

  public tick(nowMs: number = Date.now(), callbacks?: SlotEventCallbacks): void {
    const current = this.getCurrentSlot(nowMs);

    if (this.lastSlotEpoch === 0) {
      this.lastSlotEpoch = current.epoch;
    } else if (current.epoch !== this.lastSlotEpoch) {
      this.lastSlotEpoch = current.epoch;
      this.warmupFiredForSlot = 0;
      callbacks?.onRollover?.(current);
    }

    if (current.warmupPhase && this.warmupFiredForSlot !== current.epoch) {
      this.warmupFiredForSlot = current.epoch;
      const next = this.getNextSlot(nowMs);
      callbacks?.onWarmup?.(next);
    }
  }
}
