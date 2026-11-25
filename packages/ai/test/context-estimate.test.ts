import { describe, expect, it } from "vitest";
import { buildBaseOptions } from "../src/api/simple-options.ts";
import type { AssistantMessage, Model, Usage } from "../src/types.ts";
import { estimateContextTokens } from "../src/utils/estimate.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

function createUsage(totalTokens: number): Usage {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createAssistant(timestamp: number, totalTokens: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "kept" }],
		api: "openai-responses",
		provider: "openai",
		model: "test-model",
		usage: createUsage(totalTokens),
		stopReason: "stop",
		timestamp,
	};
}

/** An ACP turn's aggregate billing usage: the sum over every internal model request. */
function aggregateTurnUsage(): Usage {
	return {
		input: 165_388,
		output: 32_251,
		cacheRead: 2_840_058,
		cacheWrite: 0,
		totalTokens: 3_037_697,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

const model: Model<"openai-responses"> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10_000,
	maxTokens: 8_000,
};

describe("context token estimation", () => {
	// Regression for #10497: large new inputs need more room than chars/4 allows.
	it("reserves 3.5 characters per token for new text when limiting output", () => {
		const context = normalizeContext({
			messages: [createAssistant(100, 2_000), { role: "user", content: "x".repeat(3_500), timestamp: 200 }],
		});

		expect(estimateContextTokens(context)).toEqual({
			tokens: 3_000,
			usageTokens: 2_000,
			trailingTokens: 1_000,
			lastUsageIndex: 0,
		});
		expect(buildBaseOptions(model, context).maxTokens).toBe(2_904);
	});

	it("ignores stale assistant usage after a newer message is inserted before it", () => {
		const context = normalizeContext({
			systemPrompt: "system",
			messages: [
				{ role: "user", content: "summary", timestamp: 200 },
				createAssistant(100, 9_500),
				{ role: "user", content: "x".repeat(4_000), timestamp: 300 },
			],
		});

		expect(estimateContextTokens(context)).toEqual({
			tokens: 1_149,
			usageTokens: 0,
			trailingTokens: 1_149,
			lastUsageIndex: null,
		});
		expect(buildBaseOptions(model, context).maxTokens).toBe(4_755);
	});

	it("uses assistant usage again after a response to the inserted context", () => {
		const context = normalizeContext({
			messages: [
				{ role: "user", content: "summary", timestamp: 200 },
				createAssistant(100, 9_500),
				{ role: "user", content: "new prompt", timestamp: 300 },
				createAssistant(400, 2_000),
				{ role: "user", content: "tail", timestamp: 500 },
			],
		});

		expect(estimateContextTokens(context)).toEqual({
			tokens: 2_002,
			usageTokens: 2_000,
			trailingTokens: 2,
			lastUsageIndex: 3,
		});
	});

	// An ACP agent runs its own tool loop and reports the whole turn's billing usage.
	// Its per-request context occupancy is the last internal request only.
	it("uses a provider-reported request context instead of aggregate turn usage", () => {
		const assistant = createAssistant(100, 0);
		assistant.usage = { ...aggregateTurnUsage(), contextTokens: 135_678 };
		const context = normalizeContext({ messages: [assistant] });

		expect(estimateContextTokens(context)).toEqual({
			tokens: 135_678,
			usageTokens: 135_678,
			trailingTokens: 0,
			lastUsageIndex: 0,
		});
	});

	it("estimates from messages when the provider reports no request context", () => {
		const assistant = createAssistant(100, 0);
		assistant.usage = { ...aggregateTurnUsage(), contextTokens: null };
		const context = normalizeContext({ messages: [assistant] });

		expect(estimateContextTokens(context)).toEqual({
			tokens: 2,
			usageTokens: 0,
			trailingTokens: 2,
			lastUsageIndex: null,
		});
	});
});
