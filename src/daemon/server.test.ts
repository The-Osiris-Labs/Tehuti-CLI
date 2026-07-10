import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { TehutiDaemonServer } from "./server.js";

describe("TehutiDaemonServer Hardening", () => {
	it("handles CRLF and LF delimiters cleanly in stream buffer parsing", () => {
		const daemon = new TehutiDaemonServer();
		const mockSocket = new EventEmitter() as any;
		mockSocket.setEncoding = vi.fn();
		mockSocket.setTimeout = vi.fn();
		mockSocket.write = vi.fn();
		mockSocket.destroy = vi.fn();
		mockSocket.destroyed = false;

		const messages: any[] = [];
		const rawData: string[] = [];

		daemon.on("message", (_sock, msg) => {
			messages.push(msg);
		});

		daemon.on("data", (_sock, buf: Buffer) => {
			rawData.push(buf.toString("utf8"));
		});

		// Trigger server connection callback
		(daemon as any).server.emit("connection", mockSocket);

		// Emit CRLF JSON message
		mockSocket.emit("data", '{"type":"test","crlf":true}\r\n');
		// Emit LF JSON message
		mockSocket.emit("data", '{"type":"test","crlf":false}\n');
		// Emit mixed chunks with CRLF
		mockSocket.emit("data", '{"type":"chunked"');
		mockSocket.emit("data", ',"done":true}\r\n');
		// Emit non-JSON CRLF message
		mockSocket.emit("data", "raw_crlf_text\r\n");

		expect(messages).toEqual([
			{ type: "test", crlf: true },
			{ type: "test", crlf: false },
			{ type: "chunked", done: true },
		]);
		expect(rawData).toEqual(["raw_crlf_text"]);
	});

	it("sets umask 0o177 before listen to enforce 0o600 socket creation permissions", () => {
		const daemon = new TehutiDaemonServer();
		const umaskSpy = vi.spyOn(process, "umask");

		let listenCallback: () => void = () => {};
		vi.spyOn((daemon as any).server, "listen").mockImplementation(
			(_path: any, cb: any) => {
				listenCallback = cb;
				return (daemon as any).server;
			},
		);

		(daemon as any).listen();

		expect(umaskSpy).toHaveBeenCalledWith(0o177);

		// Trigger listen completion callback
		listenCallback();

		umaskSpy.mockRestore();
	});
});
