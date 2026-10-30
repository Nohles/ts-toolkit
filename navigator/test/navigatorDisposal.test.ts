import { afterEach, expect, test, vi } from "vitest";
import { Links, LocalizedString, Manifest, Metadata, Publication } from "@readium/shared";
import { EpubNavigator } from "../src/epub/EpubNavigator.ts";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

test("concurrent destroy callers both wait for the same resource cleanup", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const pub = new Publication({ manifest: new Manifest({
        metadata: new Metadata({ title: new LocalizedString("Concurrent disposal"), languages: ["en"] }),
        links: new Links([]), readingOrder: new Links([]),
    }) });
    const container = document.createElement("div"); document.body.append(container);
    const navigator = new EpubNavigator(container, pub, {} as never);
    await (navigator as any)._readiumRulesPromise;
    let finish: () => void = () => {};
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const destroy = vi.fn(() => gate);
    (navigator as any).framePool = { destroy };
    const first = navigator.destroy();
    let secondFinished = false;
    const second = navigator.destroy().then(() => { secondFinished = true; });
    await Promise.resolve();
    expect(secondFinished).toBe(false);
    expect(destroy).toHaveBeenCalledOnce();
    finish(); await Promise.all([first, second]);
});

test("disconnects resize observation and cancels already queued resize work on destroy", async () => {
    let callback: ResizeObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
        constructor(cb: ResizeObserverCallback) { callback = cb; }
        observe() {}
        unobserve() {}
        disconnect = disconnect;
    });
    const pending = new Map<number, FrameRequestCallback>();
    let serial = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => { pending.set(++serial, cb); return serial; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { pending.delete(id); });
    const pub = new Publication({ manifest: new Manifest({
        metadata: new Metadata({ title: new LocalizedString("Disposal fixture"), languages: ["en"] }),
        links: new Links([]), readingOrder: new Links([]),
    }) });
    const container = document.createElement("div"); document.body.append(container);
    const navigator = new EpubNavigator(container, pub, {} as never);
    const resize = vi.spyOn(navigator, "resizeHandler").mockResolvedValue();
    // Let CSS imports settle without ever loading any publication frame.
    await (navigator as any)._readiumRulesPromise;
    callback([], {} as ResizeObserver);
    const queued = [...pending.values()];
    await navigator.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(pending.size).toBe(0);
    // Even a callback already delivered by the browser must become inert.
    for (const cb of queued) await cb(1);
    callback([], {} as ResizeObserver);
    expect(pending.size).toBe(0);
    expect(resize).not.toHaveBeenCalled();
});
