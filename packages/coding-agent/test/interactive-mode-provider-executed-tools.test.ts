import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Container } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { getMarkdownTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";
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
			getShowTerminalProgress: () => false,
		},
		sessionManager: { getCwd: () => "/tmp", getEntries: () => [] },
		session: { modelRuntime: undefined, retryAttempt: 0 },
		getRegisteredToolDefinition: () => undefined,
		addMessageToChat: () => {},
		addAssistantMessageWithToolRows: Reflect.get(InteractiveMode.prototype, "addAssistantMessageWithToolRows"),
		addAssistantSegment: Reflect.get(InteractiveMode.prototype, "addAssistantSegment"),
		hideThinkingBlock: false,
		hiddenThinkingLabel: "Thinking",
		getMarkdownThemeWithSettings: () => ({ ...getMarkdownTheme(), codeBlockIndent: "" }),
		getMarkdownTransformers: () => [],
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

	test("keeps the text runs on either side of the call in transcript order", () => {
		initTheme("dark");
		const withText: AgentMessage = {
			...assistant,
			content: [
				{ type: "text", text: "Checking the build." },
				assistant.content[0],
				{ type: "text", text: "Tests pass." },
			],
		};
		const mode = createMode();
		renderSessionItems.call(mode, [withText, toolResult]);
		const output = render(mode);
		expect(output).toContain("Checking the build.");
		expect(output).toContain("all green");
		expect(output.indexOf("Checking the build.")).toBeLessThan(output.indexOf("acp_execute"));
		expect(output.indexOf("acp_execute")).toBeLessThan(output.indexOf("Tests pass."));
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

// A provider-executed call runs while its message is still streaming, so its row has to be
// drawn between the text runs instead of after the whole message. The replay tests above
// cover a finished transcript; this covers the live path that produces it.
const handleEvent = Reflect.get(InteractiveMode.prototype, "handleEvent") as (
	this: Record<string, unknown>,
	event: Record<string, unknown>,
) => Promise<void>;

function createLiveMode() {
	const mode = createMode() as Record<string, unknown> & ReturnType<typeof createMode>;
	mode.upsertToolRow = (block: unknown) => Reflect.get(InteractiveMode.prototype, "upsertToolRow").call(mode, block);
	mode.applyProviderResult = (block: unknown) =>
		Reflect.get(InteractiveMode.prototype, "applyProviderResult").call(mode, block);
	mode.isInitialized = true;
	mode.programStatus = { handleEvent: () => {} };
	mode.maybeShowThinkingDropNotice = () => {};
	mode.maybeShowCacheMissNotice = () => {};
	mode.clearStatusIndicator = () => {};
	mode.streamingComponent = undefined;
	mode.streamingSegments = [];
	mode.streamingSegmentStart = 0;
	return mode;
}

// The same call the replay fixture carries, with the outcome the server reported while streaming.
const callBlock = {
	type: "toolCall" as const,
	id: "call-1",
	name: "acp_execute",
	arguments: { CommandLine: "npm test" },
	providerExecuted: true,
	providerResult: { content: "all green" },
};

describe("InteractiveMode live provider-executed calls", () => {
	test("splits the streaming message around the call so text and row stay in order", async () => {
		initTheme("dark");
		const mode = createLiveMode();
		const streaming: AgentMessage = {
			...assistant,
			content: [{ type: "text", text: "Checking the build." }, callBlock, { type: "text", text: "Tests pass." }],
		};

		await handleEvent.call(mode, { type: "message_start", message: streaming });
		await handleEvent.call(mode, { type: "message_update", message: streaming });

		const output = render(mode as never);
		expect(output).toContain("Checking the build.");
		expect(output).toContain("acp_execute");
		expect(output).toContain("all green");
		expect(output).toContain("Tests pass.");
		expect(output.indexOf("Checking the build.")).toBeLessThan(output.indexOf("acp_execute"));
		expect(output.indexOf("acp_execute")).toBeLessThan(output.indexOf("Tests pass."));
		expect((mode.streamingSegments as unknown[]).length).toBe(2);
		expect(mode.streamingSegmentStart).toBe(2);
		expect((mode.pendingTools as Map<string, unknown>).size).toBe(1);

		await handleEvent.call(mode, { type: "message_end", message: streaming });
		expect((mode.streamingSegments as unknown[]).length).toBe(0);
		expect(mode.streamingComponent).toBeUndefined();

		// The row the stream drew already carries the provider's outcome, so ending the
		// turn drops it instead of leaving a pending row behind.
		await handleEvent.call(mode, { type: "agent_end", messages: [streaming, toolResult] });
		expect((mode.pendingTools as Map<string, unknown>).size).toBe(0);
		expect((mode.streamingSegments as unknown[]).length).toBe(0);
	});
});
