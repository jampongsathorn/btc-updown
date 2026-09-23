import fs from "fs";
import path from "path";
import crypto from "crypto";
import { LiveEngineState } from "./types.js";

export class StateStore {
  private filePath: string;
  private sequence: number = 0;

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(process.cwd(), "state", "live.json");
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  public writeState(state: LiveEngineState): void {
    this.sequence++;
    const enrichedState: LiveEngineState = {
      ...state,
      meta: {
        ...state.meta,
        snapshotId: crypto.randomUUID(),
        generatedAt: Date.now(),
        bookSequence: this.sequence,
      },
    };

    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const data = JSON.stringify(enrichedState, null, 2);

    fs.writeFileSync(tempPath, data, "utf8");
    fs.renameSync(tempPath, this.filePath);
  }

  public readState(): LiveEngineState | null {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const content = fs.readFileSync(this.filePath, "utf8");
      return JSON.parse(content) as LiveEngineState;
    } catch {
      return null;
    }
  }
}
