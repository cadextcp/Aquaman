/**
 * Review fix: `opts.signal` (the caller's AbortSignal, e.g. on client
 * disconnect) must actually reach the provider call, not just sit in the
 * function signature doing nothing. Mocks @anthropic-ai/sdk to verify
 * `messages.stream()` receives it as RequestOptions.signal — no network.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// streamCoachAnswer now logs each call to ai_call_logs (debug-log.ts) — point
// it at a throwaway SQLite file so this mocked-SDK test never touches the
// real dev database.
const TMP = path.join(tmpdir(), `aquaman-aiclientsignal-${Date.now()}`);
process.env.AQUAMAN_DATA_DIR = TMP;

beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const { db } = await import("../src/lib/db");
  migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  const { closeDb } = await import("./helpers");
  closeDb();
  rmSync(TMP, { recursive: true, force: true });
});

const streamSpy = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class FakeMessageStream {
    async *[Symbol.asyncIterator]() {
      // empty stream — just enough to let streamCoachAnswer complete normally
    }
  }
  class FakeAnthropic {
    apiKey: string;
    baseURL: string;
    constructor(opts: { apiKey: string; baseURL: string }) {
      this.apiKey = opts.apiKey;
      this.baseURL = opts.baseURL;
    }
    messages = {
      stream: (...args: unknown[]) => {
        streamSpy(...args);
        return new FakeMessageStream();
      },
    };
  }
  class FakeAPIError extends Error {}
  return { default: FakeAnthropic, APIError: FakeAPIError };
});

describe("streamCoachAnswer forwards the abort signal to the provider call", () => {
  it("passes { signal } as the second argument to client.messages.stream", async () => {
    process.env.AQUAMAN_AI_API_KEY = "test-key";
    process.env.AQUAMAN_AI_MODEL = "glm-4.6";

    const { streamCoachAnswer } = await import("../src/lib/ai/client");
    const controller = new AbortController();
    const events: unknown[] = [];

    await streamCoachAnswer({
      system: "sys",
      question: "hi",
      history: [],
      signal: controller.signal,
      onEvent: (ev) => events.push(ev),
    });

    expect(streamSpy).toHaveBeenCalledTimes(1);
    const [, options] = streamSpy.mock.calls[0] as [unknown, { signal?: AbortSignal }];
    expect(options?.signal).toBe(controller.signal);
  });

  it("still works when no signal is passed (signal is optional)", async () => {
    process.env.AQUAMAN_AI_API_KEY = "test-key";
    process.env.AQUAMAN_AI_MODEL = "glm-4.6";
    streamSpy.mockClear();

    const { streamCoachAnswer } = await import("../src/lib/ai/client");
    await streamCoachAnswer({ system: "sys", question: "hi", history: [], onEvent: () => {} });

    expect(streamSpy).toHaveBeenCalledTimes(1);
    const [, options] = streamSpy.mock.calls[0] as [unknown, { signal?: AbortSignal }];
    expect(options?.signal).toBeUndefined();
  });
});
