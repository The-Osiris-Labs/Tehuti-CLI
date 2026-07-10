import { describe, expect, it } from "vitest";
import {
	configureCollaborationTool,
	inviteCollaboratorTool,
	leaveCollaborationTool,
} from "./collaboration.js";

describe("collaborationTools", () => {
	it("configureCollaborationTool should return honest structured diagnostic indicating scaffolded transport layer", async () => {
		const mockCtx = {
			config: {},
		};

		const result = await configureCollaborationTool.execute(
			{
				enabled: true,
				sessionId: "collab-session-1",
				peers: ["peer@example.com"],
				realTime: true,
			},
			mockCtx as any,
		);

		expect(result.success).toBe(true);
		const parsed = JSON.parse(result.output);
		expect(parsed.status).toBe("scaffolded");
		expect(parsed.feature).toBe("configure_collaboration");
		expect(parsed.configured).toEqual({
			enabled: true,
			sessionId: "collab-session-1",
			peers: 1,
			realTime: true,
		});
	});

	it("inviteCollaboratorTool should return honest structured diagnostic when collaboration is enabled", async () => {
		const mockCtx = {
			config: {
				collaboration: {
					enabled: true,
					sessionId: "collab-session-1",
					peers: [],
					realTime: true,
				},
			},
		};

		const result = await inviteCollaboratorTool.execute(
			{ peer: "bob@example.com", role: "contributor" },
			mockCtx as any,
		);

		expect(result.success).toBe(true);
		const parsed = JSON.parse(result.output);
		expect(parsed.status).toBe("scaffolded");
		expect(parsed.feature).toBe("invite_collaborator");
		expect(parsed.peerRecorded).toBe("bob@example.com");
	});

	it("inviteCollaboratorTool should fail cleanly if collaboration is not enabled", async () => {
		const mockCtx = {
			config: {},
		};

		const result = await inviteCollaboratorTool.execute(
			{ peer: "bob@example.com" },
			mockCtx as any,
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("Collaboration is not enabled");
	});

	it("leaveCollaborationTool should return honest structured diagnostic indicating scaffolded session teardown", async () => {
		const mockCtx = {
			config: {
				collaboration: {
					enabled: true,
					sessionId: "collab-session-1",
					peers: ["bob@example.com"],
					realTime: true,
				},
			},
		};

		const result = await leaveCollaborationTool.execute({}, mockCtx as any);

		expect(result.success).toBe(true);
		const parsed = JSON.parse(result.output);
		expect(parsed.status).toBe("scaffolded");
		expect(parsed.feature).toBe("leave_collaboration");
	});
});
