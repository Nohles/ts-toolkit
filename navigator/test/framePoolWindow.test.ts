import { expect, test } from "vitest";
import { framePoolWindow } from "../src/epub/frame/framePoolWindow.ts";

test.each([8, 10])("window selection keeps ordering, duplicates and strict bounds with retention %i", retention => {
    const positions = Array.from({ length: 41 }, (_, i) => ({ href: `chapter-${i}` }));
    positions[0] = { href: "chapter-20" };
    positions[17] = { href: "chapter-19" };
    const { creation, disposal } = framePoolWindow(positions, 20, retention, 5);
    expect(creation).toEqual(["chapter-16", "chapter-19", "chapter-18", "chapter-20", "chapter-21", "chapter-22", "chapter-23", "chapter-24"]);
    expect(disposal).not.toContain("chapter-20");
    expect(disposal).not.toContain(`chapter-${20 - retention}`);
    expect(disposal).not.toContain(`chapter-${20 + retention}`);
    expect(disposal).toContain(`chapter-${19 - retention}`);
    expect(disposal).toContain(`chapter-${21 + retention}`);
    expect(disposal).toEqual([...new Set(disposal)]);
});

test("windows handle empty lists and both publication edges", () => {
    expect(framePoolWindow([], 0, 10, 5)).toEqual({ creation: [], disposal: [] });
    const positions = Array.from({ length: 20 }, (_, i) => ({ href: String(i) }));
    expect(framePoolWindow(positions, 0, 10, 5)).toEqual({ creation: ["0", "1", "2", "3", "4"], disposal: ["11", "12", "13", "14", "15", "16", "17", "18", "19"] });
    expect(framePoolWindow(positions, 19, 10, 5)).toEqual({ creation: ["15", "16", "17", "18", "19"], disposal: ["0", "1", "2", "3", "4", "5", "6", "7", "8"] });
});
