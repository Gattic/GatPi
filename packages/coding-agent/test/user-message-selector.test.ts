import { describe, expect, it } from "vitest";
import { UserMessageSelectorComponent } from "../src/modes/interactive/components/user-message-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const messages = Array.from({ length: 40 }, (_, index) => ({ id: `entry-${index}`, text: `message ${index}` }));

describe("UserMessageSelectorComponent", () => {
	it("keeps the selector inside the visible viewport", () => {
		initTheme("dark");

		for (const terminalHeight of [24, 40, 60]) {
			const selector = new UserMessageSelectorComponent(
				messages,
				() => {},
				() => {},
				messages[messages.length - 1]?.id,
				terminalHeight,
			);
			const lines = selector.render(120);
			// The renderer reserves a few rows below the selector for the footer.
			expect(lines.length).toBeLessThanOrEqual(terminalHeight - 3);
		}
	});

	it("renders every message when they fit without scrolling", () => {
		initTheme("dark");
		const selector = new UserMessageSelectorComponent(
			messages.slice(0, 3),
			() => {},
			() => {},
			undefined,
			40,
		);
		const lines = selector.render(120);

		expect(lines.filter((line) => /message \d/.test(line)).length).toBe(3);
	});
});
