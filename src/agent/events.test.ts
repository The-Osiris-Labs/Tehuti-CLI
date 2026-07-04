import { describe, it, expect, beforeEach, vi } from "vitest";
import { agentEventBus, wakeupQueue } from "./events.js";

describe("events and WakeupQueue", () => {
	beforeEach(() => {
		wakeupQueue.clear();
	});

	it("should queue wakeups when no one is listening and consume them in order", async () => {
		agentEventBus.emit("wakeup", "msg1");
		agentEventBus.emit("wakeup", "msg2");

		expect(wakeupQueue.isEmpty).toBe(false);

		const first = await wakeupQueue.consume();
		expect(first).toBe("msg1");

		const second = await wakeupQueue.consume();
		expect(second).toBe("msg2");

		expect(wakeupQueue.isEmpty).toBe(true);
	});

	it("should wait for next wakeup if queue is empty", async () => {
		expect(wakeupQueue.isEmpty).toBe(true);

		let resolvedValue = "";
		const consumePromise = wakeupQueue.consume().then((val) => {
			resolvedValue = val;
		});

		// At this point, promise is pending.
		expect(resolvedValue).toBe("");

		agentEventBus.emit("wakeup", "delayed_msg");

		await consumePromise;

		expect(resolvedValue).toBe("delayed_msg");
		expect(wakeupQueue.isEmpty).toBe(true);
	});

	it("should handle error events safely without crashing", () => {
		// Mock console.error to avoid spamming the test output
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		
		expect(() => {
			agentEventBus.emit("error", new Error("test error"));
		}).not.toThrow();
		
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});
