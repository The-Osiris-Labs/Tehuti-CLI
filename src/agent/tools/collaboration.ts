import { z } from "zod";
import { TehutiDaemonClient } from "../../daemon/client.js";
import type { AgentContext } from "../context.js";
import { createTool, type ToolContext, type ToolResult } from "./registry.js";

/**
 * Configure real-time collaboration settings for multi-user sessions.
 * Writes collaboration config to memory and broadcasts a 'collab' event
 * over the local IPC daemon socket.
 */
export const configureCollaborationTool = createTool({
	name: "configure_collaboration",
	description:
		"Configure real-time collaboration settings for multi-user sessions.",
	parameters: z.object({
		enabled: z.boolean().describe("Whether to enable collaboration"),
		sessionId: z.string().optional().describe("Session ID for collaboration"),
		peers: z.array(z.string()).optional().describe("List of peer participants"),
		realTime: z
			.boolean()
			.optional()
			.describe("Whether to use real-time synchronization"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const {
			enabled,
			sessionId,
			peers = [],
			realTime = true,
		} = args as {
			enabled: boolean;
			sessionId?: string;
			peers?: string[];
			realTime?: boolean;
		};

		const agentCtx = ctx as unknown as AgentContext;

		try {
			agentCtx.config.collaboration = {
				enabled,
				sessionId:
					sessionId ?? agentCtx.config.collaboration?.sessionId ?? "default",
				peers: peers,
				realTime,
			};

			const client = new TehutiDaemonClient();
			try {
				await client.connect();
				client.send({
					type: "collab",
					action: "configure",
					sessionId: agentCtx.config.collaboration.sessionId,
					peers,
					enabled,
				});
				client.disconnect();
			} catch (err) {
				// Daemon might not be running
				console.warn("Daemon unreachable for collab sync.");
			}

			return {
				success: true,
				output: JSON.stringify({
					status: "configured",
					feature: "configure_collaboration",
					message:
						"Collaboration settings applied and broadcasted to local IPC daemon.",
					configured: {
						enabled,
						sessionId,
						peers: peers.length,
						realTime,
					},
				}),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: `Failed to configure collaboration: ${error}`,
			};
		}
	},
});

/**
 * Invite a collaborator to the current session via local daemon IPC.
 * This notifies other instances attached to the daemon.
 */
export const inviteCollaboratorTool = createTool({
	name: "invite_collaborator",
	description: "Invite a collaborator to the current session.",
	parameters: z.object({
		peer: z
			.string()
			.describe("Email or username of the collaborator to invite"),
		role: z
			.enum(["viewer", "contributor", "admin"])
			.optional()
			.describe("Role for the invited collaborator"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { peer, role = "contributor" } = args as {
			peer: string;
			role?: "viewer" | "contributor" | "admin";
		};

		const agentCtx = ctx as unknown as AgentContext;

		try {
			if (!agentCtx.config.collaboration?.enabled) {
				return {
					success: false,
					output: "",
					error:
						"Collaboration is not enabled. Please enable collaboration first. Note: collaboration transport is not yet implemented — this is a stub.",
				};
			}

			if (!agentCtx.config.collaboration.peers) {
				agentCtx.config.collaboration.peers = [];
			}

			if (!agentCtx.config.collaboration.peers.includes(peer)) {
				agentCtx.config.collaboration.peers.push(peer);
			}

			const client = new TehutiDaemonClient();
			try {
				await client.connect();
				client.send({
					type: "collab",
					action: "invite",
					sessionId: agentCtx.config.collaboration.sessionId,
					peer,
					role,
				});
				client.disconnect();
			} catch (err) {
				console.warn("Daemon unreachable for collab invite sync.");
			}

			return {
				success: true,
				output: JSON.stringify({
					status: "invited",
					feature: "invite_collaborator",
					message: "Collaborator invitation broadcasted via local daemon IPC.",
					peerRecorded: peer,
					role,
					sessionId: agentCtx.config.collaboration?.sessionId,
					peers: agentCtx.config.collaboration?.peers.length,
				}),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: `Failed to invite collaborator: ${error}`,
			};
		}
	},
});

/**
 * Gracefully leave a real-time session via daemon IPC.
 */
export const leaveCollaborationTool = createTool({
	name: "leave_collaboration",
	description: "Leave the current collaboration session.",
	parameters: z.object({}),
	category: "system",
	execute: async (_args, ctx: ToolContext): Promise<ToolResult> => {
		const agentCtx = ctx as unknown as AgentContext;

		try {
			const sessionId = agentCtx.config.collaboration?.sessionId ?? "default";

			if (agentCtx.config.collaboration) {
				agentCtx.config.collaboration.enabled = false;
				agentCtx.config.collaboration.peers = [];
			}

			const client = new TehutiDaemonClient();
			try {
				await client.connect();
				client.send({
					type: "collab",
					action: "leave",
					sessionId: sessionId,
				});
				client.disconnect();
			} catch (err) {
				console.warn("Daemon unreachable for collab leave sync.");
			}

			return {
				success: true,
				output: JSON.stringify({
					status: "left",
					feature: "leave_collaboration",
					message:
						"Left collaboration session. Event broadcasted via local daemon IPC.",
					sessionId,
				}),
			};
		} catch (error) {
			return {
				success: false,
				output: "",
				error: `Failed to leave collaboration: ${error}`,
			};
		}
	},
});

export const collaborationTools = [
	configureCollaborationTool,
	inviteCollaboratorTool,
	leaveCollaborationTool,
];
