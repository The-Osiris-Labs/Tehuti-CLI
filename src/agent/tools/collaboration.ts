import { z } from "zod";
import { createTool, type ToolContext, type ToolResult } from "./registry.js";
import type { AgentContext } from "../context.js";

export const configureCollaborationTool = createTool({
	name: "configure_collaboration",
	description: "Configure real-time collaboration settings for multi-user sessions.",
	parameters: z.object({
		enabled: z.boolean().describe("Whether to enable collaboration"),
		sessionId: z.string().optional().describe("Session ID for collaboration"),
		peers: z.array(z.string()).optional().describe("List of peer participants"),
		realTime: z.boolean().optional().describe("Whether to use real-time synchronization"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { enabled, sessionId, peers = [], realTime = true } = args as { 
			enabled: boolean; 
			sessionId?: string; 
			peers?: string[]; 
			realTime?: boolean;
		};
		
		const agentCtx = ctx as unknown as AgentContext;
		
		try {
			agentCtx.config.collaboration = {
				enabled,
				sessionId,
				peers,
				realTime,
			};
			
			return {
				success: true,
				output: JSON.stringify({
					message: `Collaboration ${enabled ? "enabled" : "disabled"}`,
					sessionId,
					peers: peers.length,
					realTime,
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

export const inviteCollaboratorTool = createTool({
	name: "invite_collaborator",
	description: "Invite a collaborator to the current session.",
	parameters: z.object({
		peer: z.string().describe("Email or username of the collaborator to invite"),
		role: z.enum(["viewer", "contributor", "admin"]).optional().describe("Role for the invited collaborator"),
	}),
	category: "system",
	execute: async (args, ctx: ToolContext): Promise<ToolResult> => {
		const { peer, role = "contributor" } = args as { peer: string; role?: "viewer" | "contributor" | "admin" };
		
		const agentCtx = ctx as unknown as AgentContext;
		
		try {
			if (!agentCtx.config.collaboration?.enabled) {
				return {
					success: false,
					output: "",
					error: "Collaboration is not enabled. Please enable collaboration first.",
				};
			}
			
			if (!agentCtx.config.collaboration.peers) {
				agentCtx.config.collaboration.peers = [];
			}
			
			if (!agentCtx.config.collaboration.peers.includes(peer)) {
				agentCtx.config.collaboration.peers.push(peer);
			}
			
			return {
				success: true,
				output: JSON.stringify({
					message: `Collaborator ${peer} invited as ${role}`,
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

export const leaveCollaborationTool = createTool({
	name: "leave_collaboration",
	description: "Leave the current collaboration session.",
	parameters: z.object({}),
	category: "system",
	execute: async (_args, ctx: ToolContext): Promise<ToolResult> => {
		const agentCtx = ctx as unknown as AgentContext;
		
		try {
			agentCtx.config.collaboration = {
				enabled: false,
				realTime: true,
			};
			
			return {
				success: true,
				output: JSON.stringify({
					message: "Left collaboration session",
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
