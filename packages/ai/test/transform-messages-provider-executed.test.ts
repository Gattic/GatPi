import { describe, expect, it } from "vitest";
import { transformMessages } from "../src/api/transform-messages.ts";
import type { AssistantMessage, Message, Model } from "../src/types.ts";

function makeAnthropicModel(): Model<"anthropic-messages"> {
	return {
		id: "claude-opus-5-5",
		name: "Claude Opus 5.5",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 16000,
	};
}

function makeAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "antigravity-acp",
		provider: "google-antigravity-acp",
		model: "gemini-4-neon",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

// ACP records its own tool calls as provider-executed blocks, and Pi answers them with the
// server's reported result. An interrupted turn keeps the blocks but never gets a result, so the
// errored message must be dropped rather than replayed as an unanswered tool call.
describe("provider-executed calls in the provider request", () => {
	const model = makeAnthropicModel();
	const normalize = (id: string) => id;

	it("drops an interrupted ACP turn instead of replaying an unanswered call", () => {
		const messages: Message[] = [
			{ role: "user", content: "run the tests", timestamp: Date.now() },
			makeAssistantMessage(
				[
					{
						type: "toolCall",
						id: "call-1",
						name: "acp_execute",
						arguments: { CommandLine: "npm test" },
						providerExecuted: true,
					},
				],
				"aborted",
			),
		];

		const result = transformMessages(messages, model, normalize);
		expect(result).toHaveLength(1);
		expect(result[0]?.role).toBe("user");
		expect(result.some((message) => message.role === "toolResult")).toBe(false);
	});

	it("keeps a completed ACP call beside the result Pi recorded for it", () => {
		const messages: Message[] = [
			{ role: "user", content: "run the tests", timestamp: Date.now() },
			makeAssistantMessage([
				{
					type: "toolCall",
					id: "call-1",
					name: "acp_execute",
					arguments: { CommandLine: "npm test" },
					providerExecuted: true,
					providerResult: { content: "all green" },
				},
			]),
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "acp_execute",
				content: [{ type: "text", text: "all green" }],
				isError: false,
				timestamp: Date.now(),
			},
		];

		const result = transformMessages(messages, model, normalize);
		const assistant = result.find((message) => message.role === "assistant");
		const toolResult = result.find((message) => message.role === "toolResult");
		expect(assistant?.role === "assistant" ? assistant.content : undefined).toEqual([
			{
				type: "toolCall",
				id: "call-1",
				name: "acp_execute",
				arguments: { CommandLine: "npm test" },
				providerExecuted: true,
				providerResult: { content: "all green" },
			},
		]);
		expect(toolResult?.role === "toolResult" ? toolResult.content : undefined).toEqual([
			{ type: "text", text: "all green" },
		]);
		expect(result.some((message) => message.role === "toolResult" && message.isError)).toBe(false);
	});
});
