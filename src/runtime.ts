import { Config } from "./config.js";

class Runtime {
  private config: Config | null = null;

  setConfig(config: Config): void {
    this.config = config;
  }

  requireConfig(): Config {
    if (!this.config) throw new Error("runtime config not initialized");
    return this.config;
  }
}

export const runtime = new Runtime();
