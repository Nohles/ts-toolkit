import { afterEach, expect, test, vi } from "vitest";
import { Link, Links, LocalizedString, Locator, LocatorLocations, Manifest, Metadata, Publication } from "@readium/shared";
import { EpubNavigator } from "../src/epub/EpubNavigator.ts";
import { FramePoolManager } from "../src/epub/frame/FramePoolManager.ts";

const locator = (href: string, position: number) => new Locator({ href, type: "application/xhtml+xml", locations: new LocatorLocations({ position }) });
const publication = (hrefs: string[], toc?: Links) => new Publication({ manifest: new Manifest({
    metadata: new Metadata({ title: new LocalizedString("Position fixture"), languages: ["en"] }),
    links: new Links([]), readingOrder: new Links(hrefs.map(href => new Link({ href }))), toc,
}) });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function cachedPool(positions: Locator[], current: number) {
    const manager = new FramePoolManager(document.createElement("div"), positions);
    const pool = manager as any;
    const frames = new Map(positions.map(position => [position.href, {
        source: position.href, load: vi.fn().mockResolvedValue(undefined), destroy: vi.fn().mockResolvedValue(undefined),
    }]));
    for (const [href, frame] of frames) { pool.pool.set(href, frame); pool.blobs.set(href, { reset() {} }); }
    pool._currentFrame = frames.get(positions[current].href);
    return { manager, frames };
}

test("updating a large real frame pool does bounded membership work", async () => {
    const count = 2_000;
    const positions = Array.from({ length: count }, (_, i) => locator(`chapter-${i}.xhtml`, i + 1));
    const pub = publication(positions.map(position => position.href));
    const { manager, frames } = cachedPool(positions, 0);
    const original = Array.prototype.includes;
    let searchedSlots = 0;
    const spy = vi.spyOn(Array.prototype, "includes").mockImplementation(function (this: unknown[], value: unknown, start?: number) {
        if (this.length > 20 && typeof value === "string" && value.startsWith("chapter-")) searchedSlots += this.length;
        return original.call(this, value, start);
    });
    try { await manager.update(pub, positions[0], []); }
    finally { spy.mockRestore(); }
    expect(frames.get("chapter-0.xhtml")?.destroy).not.toHaveBeenCalled();
    expect(frames.get("chapter-1999.xhtml")?.destroy).toHaveBeenCalledOnce();
    expect(searchedSlots).toBeLessThanOrEqual(count * 20);
    await manager.destroy();
});

test("pool updates preserve strict creation bounds, inclusive retention bounds and shared hrefs", async () => {
    const positions = Array.from({ length: 41 }, (_, i) => locator(`chapter-${i}.xhtml`, i + 1));
    positions[0] = locator("chapter-20.xhtml", 1);
    positions[17] = locator("chapter-19.xhtml", 18);
    const { manager, frames } = cachedPool(positions, 20);
    await manager.update(publication(positions.map(position => position.href)), positions[20], []);
    expect(frames.get("chapter-20.xhtml")?.destroy).not.toHaveBeenCalled();
    expect(frames.get("chapter-19.xhtml")?.load).toHaveBeenCalledOnce();
    expect(frames.get("chapter-16.xhtml")?.load).toHaveBeenCalledOnce();
    expect(frames.get("chapter-24.xhtml")?.load).toHaveBeenCalledOnce();
    expect(frames.get("chapter-15.xhtml")?.load).not.toHaveBeenCalled();
    expect(frames.get("chapter-25.xhtml")?.load).not.toHaveBeenCalled();
    expect(frames.get("chapter-10.xhtml")?.destroy).not.toHaveBeenCalled();
    expect(frames.get("chapter-30.xhtml")?.destroy).not.toHaveBeenCalled();
    expect(frames.get("chapter-9.xhtml")?.destroy).toHaveBeenCalledOnce();
    expect(frames.get("chapter-31.xhtml")?.destroy).toHaveBeenCalledOnce();
    await manager.destroy();
});

test("real navigator timeline augmentation indexes a large position list once", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const count = 2_000;
    const hrefs = Array.from({ length: count }, (_, i) => `chapter-${i}.xhtml`);
    let reads = 0;
    const positions = hrefs.map((href, i) => {
        const position = locator(href, i + 1);
        Object.defineProperty(position, "href", { get() { reads++; return href; } });
        return position;
    });
    const navigator = new EpubNavigator(document.createElement("div"), publication(hrefs), {} as never, positions);
    try {
        await (navigator as any)._readiumRulesPromise;
        const timeline = navigator.timeline;
        expect(timeline.items[count - 1].position).toBe(count);
        const firstReads = reads;
        expect(navigator.timeline).toBe(timeline);
        expect(reads).toBe(firstReads);
        expect(reads).toBeLessThanOrEqual(count * 5);
    } finally { await navigator.destroy(); }
});

test("augmentation preserves minimum positions, first fragment matches and one fallback per resource", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const at = (href: string, position?: number, fragments?: string[], progression?: number) => new Locator({
        href, type: "application/xhtml+xml", locations: new LocatorLocations({ position, fragments, progression }),
    });
    const positions = [at("a", 20, ["exact"], 0.2), at("a", 3, ["other", "late"], 0.1), at("a", 9, ["exact"], 0.8), at("b"), at("b", 5)];
    const toc = new Links(["exact", "missing", "late", "exact"].map((fragment, index) => new Link({ href: `a#${fragment}`, title: `Part ${index}` })));
    const navigator = new EpubNavigator(document.createElement("div"), publication(["a", "b", "b"], toc), {} as never, positions);
    try {
        await (navigator as any)._readiumRulesPromise;
        const items = navigator.timeline.items;
        expect(items[0].position).toBeUndefined();
        expect(items[0].children?.map(item => [item.position, item.scroll])).toEqual([
            [20, 0.2], [3, undefined], [undefined, undefined], [20, 0.2],
        ]);
        expect(items[1].position).toBe(5);
        expect(items[2].position).toBeUndefined();
    } finally { await navigator.destroy(); }
});
