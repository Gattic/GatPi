import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Container } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const renderSessionItems = Reflect.get(InteractiveMode.prototype, "renderSessionItems") as (
	this: Record<string, unknown>,
	items: AgentMessage[],
	messageMeta?: undefined,
	options?: { updateFooter?: boolean },
) => void;

// ACP records the server's own tool call as a provider-executed block. The TUI draws tool rows
// from toolCall blocks and completes them from toolResult messages, so an ACP call has to end up
// as an ordinary finished row instead of staying pending or rendering nothing.
const assistant: AgentMessage = {
	role: "assistant",
	content: [
		{
			type: "toolCall",
			id: "call-1",
			name: "acp_execute",
			arguments: { CommandLine: "npm test" },
			providerExecuted: true,
			providerResult: { content: "all green" },
		},
		{ type: "text", text: "Tests pass." },
	],
	api: "antigravity-acp",
	provider: "google-antigravity-acp",
	model: "gemini-4-neon",
	usage: {
		input: 10,
		output: 5,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 15,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: 1,
};

const toolResult: AgentMessage = {
	role: "toolResult",
	toolCallId: "call-1",
	toolName: "acp_execute",
	content: [{ type: "text", text: "all green" }],
	isError: false,
	timestamp: 2,
};

function createMode() {
	const chatContainer = new Container();
	const pendingTools = new Map<string, unknown>();
	const mode = {
		chatContainer,
		pendingTools,
		outputPad: 1,
		toolOutputExpanded: false,
		ui: { requestRender: () => {} },
		footer: { invalidate: () => {} },
		updateEditorBorderColor: () => {},
		settingsManager: {
			getShowImages: () => false,
			getImageWidthCells: () => 60,
			getShowCacheMissNotices: () => false,
		},
		sessionManager: { getCwd: () => "/tmp", getEntries: () => [] },
		session: { modelRuntime: undefined, retryAttempt: 0 },
		getRegisteredToolDefinition: () => undefined,
		addMessageToChat: () => {},
		addCustomEntryToChat: () => {},
		addCacheWarmingUsage: () => {},
		addCompactionCostNotice: () => {},
	};
	return mode;
}

function render(mode: ReturnType<typeof createMode>): string {
	return stripAnsi(mode.chatContainer.render(120).join("\n"));
}

describe("InteractiveMode provider-executed tool rows", () => {
	test("draws the server's call with its arguments and completes it with the server's output", () => {
		initTheme("dark");

		const running = createMode();
		renderSessionItems.call(running, [assistant]);
		const runningOutput = render(running);
		expect(runningOutput).toContain("acp_execute");
		expect(runningOutput).toContain("npm test");
		expect(runningOutput).not.toContain("all green");
		expect(running.pendingTools.size).toBe(1);

		const finished = createMode();
		renderSessionItems.call(finished, [assistant, toolResult]);
		const finishedOutput = render(finished);
		expect(finishedOutput).toContain("acp_execute");
		expect(finishedOutput).toContain("all green");
		expect(finished.pendingTools.size).toBe(0);
	});

	test("marks a row whose call the server reported as failed", () => {
		initTheme("dark");
		const mode = createMode();
		renderSessionItems.call(mode, [
			assistant,
			{ ...toolResult, content: [{ type: "text", text: "permission denied" }], isError: true },
		]);
		expect(render(mode)).toContain("permission denied");
	});
});
