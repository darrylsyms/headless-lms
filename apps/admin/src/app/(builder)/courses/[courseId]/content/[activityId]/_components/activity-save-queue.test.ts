import { expect, it } from "vitest";
import { queueActivitySave } from "./activity-save-queue";

it("serializes writes to the same activity and continues after a failure", async () => {
  const calls: string[] = [];
  let release!: () => void;
  let signalStarted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const first = queueActivitySave("act_test", async () => { calls.push("first"); signalStarted(); await gate; throw new Error("failed"); });
  const second = queueActivitySave("act_test", async () => { calls.push("second"); return "saved"; });
  await started;
  expect(calls).toEqual(["first"]);
  release();
  await expect(first).rejects.toThrow("failed");
  await expect(second).resolves.toBe("saved");
  expect(calls).toEqual(["first", "second"]);
});
