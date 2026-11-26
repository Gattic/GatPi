import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportFromFile } from "../src/core/export-html/index.ts";
import { SessionManager } from "../src/core/session-manager.ts";

// An ACP turn records the server's own tool call as a provider-executed block beside the
// result Pi recorded for it. The export renders tool calls by name and shows their output, so
// a call Pi never ran must render like any other, without a registered tool renderer.
describe("export HTML with provider-executed tool calls", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-export-acp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	});

	it("renders the server's call, its arguments and its output", async () => {
		const sessionManager = SessionManager.create(tempDir, join(tempDir, "sessions"), { id: "acp-export" });
		sessionManager.appendMessage({ role: "user", content: "Run the tests", timestamp: Date.now() });
		sessionManager.appendMessage({
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
			timestamp: Date.now(),
		});
		sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "acp_execute",
			content: [{ type: "text", text: "all green" }],
			isError: false,
			timestamp: Date.now(),
		});

		const sessionFile = sessionManager.getSessionFile();
		expect(sessionFile).toBeDefined();
		const outputPath = join(tempDir, "export.html");
		await exportFromFile(sessionFile!, outputPath);
		const html = readFileSync(outputPath, "utf8");

		// The export embeds the session as base64 JSON and renders tool calls in the browser, so the
		// pair has to survive serialization for the generic tool renderer to find it.
		const match = /<script id="session-data" type="application\/json">([^<]+)<\/script>/u.exec(html);
		expect(match).not.toBeNull();
		const data = JSON.parse(Buffer.from(match![1]!, "base64").toString("utf8")) as {
			entries: Array<{ type: string; message?: Record<string, any> }>;
		};
		const assistant = data.entries.find((entry) => entry.message?.role === "assistant");
		const toolResult = data.entries.find((entry) => entry.message?.role === "toolResult");
		expect(assistant?.message?.content).toEqual([
			{
				type: "toolCall",
				id: "call-1",
				name: "acp_execute",
				arguments: { CommandLine: "npm test" },
				providerExecuted: true,
				providerResult: { content: "all green" },
			},
			{ type: "text", text: "Tests pass." },
		]);
		expect(toolResult?.message).toMatchObject({
			toolCallId: "call-1",
			toolName: "acp_execute",
			isError: false,
			content: [{ type: "text", text: "all green" }],
		});
	});
});
