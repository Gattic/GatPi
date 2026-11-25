import assert from "node:assert";
import { describe, it } from "node:test";
import type { Component, TUI } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class Lines implements Component {
	private lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	setLines(lines: string[]): void {
		this.lines = lines;
	}

	render(): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

function recordWrites(terminal: VirtualTerminal): string[] {
	const writes: string[] = [];
	const original = terminal.write.bind(terminal);
	terminal.write = (data: string) => {
		writes.push(data);
		original(data);
	};
	return writes;
}

describe("TUI render suspension", () => {
	it("defers pending renders until resumed", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const content = new Lines(["first"]);
		tui.addChild(content);
		tui.start();
		await terminal.waitForRender();

		const writes = recordWrites(terminal);

		tui.suspendRender();
		content.setLines(["second"]);
		tui.requestRender();
		await terminal.waitForRender();
		assert.equal(writes.length, 0, "suspended render must not write to the terminal");

		tui.resumeRender();
		await terminal.waitForRender();
		assert.ok(writes.length > 0, "resume must flush the pending render");
		assert.ok(terminal.getViewport().some((line) => line.includes("second")));

		tui.stop();
	});

	it("drops a frame that was scheduled before suspending", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const content = new Lines(["first"]);
		tui.addChild(content);
		tui.start();
		await terminal.waitForRender();

		const writes = recordWrites(terminal);

		content.setLines(["second"]);
		tui.requestRender();
		tui.suspendRender();
		await terminal.waitForRender();
		assert.equal(writes.length, 0, "pre-suspension frame must be dropped");

		tui.resumeRender();
		await terminal.waitForRender();
		assert.ok(terminal.getViewport().some((line) => line.includes("second")));

		tui.stop();
	});

	it("coalesces multiple requests into one render", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const content = new Lines(["first"]);
		tui.addChild(content);
		tui.start();
		await terminal.waitForRender();

		const writes = recordWrites(terminal);

		tui.suspendRender();
		content.setLines(["second"]);
		tui.requestRender();
		await terminal.waitForRender();
		content.setLines(["third"]);
		tui.requestRender(true);
		await terminal.waitForRender();
		assert.equal(writes.length, 0);

		tui.resumeRender();
		await terminal.waitForRender();
		assert.ok(terminal.getViewport().some((line) => line.includes("third")));
		assert.ok(!terminal.getViewport().some((line) => line.includes("second")));

		tui.stop();
	});

	it("only resumes on the outermost suspension", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const content = new Lines(["first"]);
		tui.addChild(content);
		tui.start();
		await terminal.waitForRender();

		const writes = recordWrites(terminal);

		tui.suspendRender();
		tui.suspendRender();
		content.setLines(["second"]);
		tui.requestRender();
		tui.resumeRender();
		await terminal.waitForRender();
		assert.equal(writes.length, 0, "nested suspension must keep renders deferred");

		tui.resumeRender();
		await terminal.waitForRender();
		assert.ok(writes.length > 0);
		assert.ok(terminal.getViewport().some((line) => line.includes("second")));

		tui.stop();
	});

	it("does not repaint intermediate transcript states during a suspended shrink", async () => {
		const terminal = new VirtualTerminal(40, 10);
		const tui: TUI = new TuiMainScreen(terminal);
		const content = new Lines(Array.from({ length: 100 }, (_, i) => `line ${i}`));
		tui.addChild(content);
		tui.start();
		await terminal.waitForRender();

		const writes = recordWrites(terminal);

		// Simulate the intermediate teardown state of a session replacement:
		// the transcript shrinks far above the viewport, which would normally
		// clear the scrollback and replay the document.
		tui.suspendRender();
		content.setLines(Array.from({ length: 50 }, (_, i) => `line ${i}`));
		tui.requestRender();
		await terminal.waitForRender();
		content.setLines(["final"]);
		tui.requestRender();
		await terminal.waitForRender();
		assert.equal(writes.length, 0, "intermediate states must not be painted");

		tui.resumeRender();
		await terminal.waitForRender();

		const output = writes.join("");
		const clears = output.split("\x1b[3J").length - 1;
		assert.equal(clears, 1, "the final state should repaint the scrollback exactly once");
		assert.ok(!output.includes("line 49"), "intermediate transcript content must not be painted");
		assert.ok(terminal.getViewport().some((line) => line.includes("final")));

		tui.stop();
	});
});
