import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { FrameManager } from "../src/epub/frame/FrameManager.ts";
import { FramePoolManager } from "../src/epub/frame/FramePoolManager.ts";
import FrameBlobBuilder from "../src/epub/frame/FrameBlobBuilder.ts";
import { FXLFrameManager } from "../src/epub/fxl/FXLFrameManager.ts";
import { WebPubFrameManager } from "../src/webpub/WebPubFrameManager.ts";
import { WebPubFramePoolManager } from "../src/webpub/WebPubFramePoolManager.ts";
import { ReadingProgression } from "@readium/shared";
import { Injector } from "../src/injection/Injector.ts";

beforeAll(() => {
    // jsdom lacks iframe.sandbox's DOMTokenList, which browsers provide.
    Object.defineProperty(HTMLIFrameElement.prototype, "sandbox", {
        configurable: true,
        get() { return { value: "" }; },
    });
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

const fixture = (kind: "epub" | "webpub" | "fixed", attached = false, ready = true) => {
    const owner = document.createElement("div");
    document.body.append(owner);
    const manager = kind === "epub" ? new FrameManager("blob:fixture")
        : kind === "webpub" ? new WebPubFrameManager("blob:fixture")
        : new FXLFrameManager({} as never, ReadingProgression.ltr, "chapter.xhtml");
    // These are the actual managers' runtime fields, not a replacement for
    // their hide/destroy implementations. The remote iframe never acknowledges.
    const frame = manager as any;
    if (kind === "fixed") {
        // 2.14 attaches FXL iframes lazily on first load. Reproduce an initialized
        // frame without starting a real navigation in jsdom.
        frame.wrapper.append(frame.frame);
        frame.frameIsAppended = true;
    }
    owner.append(kind === "fixed" ? frame.wrapper : frame.frame);
    const comms = { ready, halt: vi.fn(), send: vi.fn() };
    const loader = { destroy: vi.fn() };
    const bridge = { destroy: vi.fn() };
    frame.comms = comms; frame.loader = loader; frame.conditionBridge = bridge;
    if (!attached) owner.remove();
    return { manager, frame, owner, comms, loader, bridge };
};

const completed = async (promise: Promise<unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise.then(() => true),
            new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 40); }),
        ]);
    } finally { clearTimeout(timer); }
};

for (const kind of ["epub", "webpub", "fixed"] as const) describe(`${kind} terminal frame disposal`, () => {
    test("finishes after React detaches the containing tree", async () => {
        const f = fixture(kind);
        expect(f.frame.frame.parentElement).not.toBeNull();
        expect(f.frame.frame.isConnected).toBe(false);
        expect(await completed(f.manager.destroy())).toBe(true);
        expect(f.comms.send).not.toHaveBeenCalled();
        expect(f.comms.halt).toHaveBeenCalledOnce();
        expect(f.loader.destroy).toHaveBeenCalledOnce();
        expect(f.bridge.destroy).toHaveBeenCalledOnce();
        expect(f.frame.frame.parentElement).toBeNull();
    });

    test("does not require a remote acknowledgement even while connected", async () => {
        const f = fixture(kind, true);
        expect(await completed(f.manager.destroy())).toBe(true);
        expect(f.comms.send).not.toHaveBeenCalled();
        expect(f.frame.frame.isConnected).toBe(false);
    });

    test("halts comms that have not become ready", async () => {
        const f = fixture(kind, false, false);
        expect(await completed(f.manager.destroy())).toBe(true);
        expect(f.comms.halt).toHaveBeenCalledOnce();
    });

    test("is idempotent for concurrent and repeated callers", async () => {
        const f = fixture(kind);
        expect(await completed(Promise.all([f.manager.destroy(), f.manager.destroy()]))).toBe(true);
        await f.manager.destroy();
        expect(f.loader.destroy).toHaveBeenCalledOnce();
        expect(f.bridge.destroy).toHaveBeenCalledOnce();
    });

    test("terminal cleanup bypasses a serialized unfocus awaiting a remote reply", async () => {
        const f = fixture(kind, true);
        let reply: (() => void) | undefined;
        f.comms.send.mockImplementation((_key: string, _data: unknown, ack?: () => void) => { reply = ack; });
        const waiting = kind === "fixed" ? (f.manager as FXLFrameManager).unfocus()
            : (f.manager as FrameManager | WebPubFrameManager).hide();
        await Promise.resolve();
        expect(reply).toBeTypeOf("function");
        expect(await completed(f.manager.destroy())).toBe(true);
        expect(f.comms.halt).toHaveBeenCalledOnce();
        expect(f.frame.frame.isConnected).toBe(false);
        reply!();
        await waiting;
    });

    test("pauses embedded media before removing a connected browsing context", async () => {
        const f = fixture(kind, true);
        const media = f.frame.frame.contentDocument.createElement("audio") as HTMLMediaElement;
        f.frame.frame.contentDocument.body.append(media);
        const pause = vi.spyOn(media, "pause").mockImplementation(() => {});
        expect(await completed(f.manager.destroy())).toBe(true);
        expect(pause).toHaveBeenCalledOnce();
    });

    test("finishes other cleanup if module teardown throws", async () => {
        const f = fixture(kind, false, false);
        f.loader.destroy.mockImplementation(() => { throw Error("Module cleanup failed"); });
        const outcome = f.manager.destroy().catch(error => error);
        expect(await completed(outcome)).toBe(true);
        expect(await outcome).toBeInstanceOf(Error);
        expect(f.comms.halt).toHaveBeenCalledOnce();
        expect(f.frame.frame.parentElement).toBeNull();
    });
});

test("temporary hiding still waits for the connected frame's unfocus acknowledgement", async () => {
    const f = fixture("epub", true);
    let reply: (() => void) | undefined;
    f.comms.send.mockImplementation((_key: string, _data: unknown, ack?: () => void) => { reply = ack; });
    let hidden = false;
    const pending = f.manager.hide().then(() => { hidden = true; });
    await Promise.resolve();
    expect(hidden).toBe(false);
    expect(f.comms.send).toHaveBeenCalledWith("unfocus", undefined, expect.any(Function));
    reply!(); await pending;
    expect(f.frame.frame.isConnected).toBe(true);
    expect(f.loader.destroy).not.toHaveBeenCalled();
});

for (const kind of ["epub", "webpub"] as const) test(`${kind} pool releases frames, current reference and cached blobs`, async () => {
    const f = fixture(kind);
    const injector = { dispose: vi.fn(), releaseBlobUrl: vi.fn() };
    const pool = (kind === "epub" ? new FramePoolManager(f.owner, [], {}, injector as never)
        : new WebPubFramePoolManager(f.owner, {}, injector as never)) as any;
    pool.pool.set("chapter.xhtml", f.manager);
    if (kind === "epub") {
        const builder = new FrameBlobBuilder({} as never, "", {} as never, {}) as any;
        builder.currentUrl = "blob:cached";
        builder.currentResource = { close: vi.fn() };
        pool.blobs.set("chapter.xhtml", builder);
    } else {
        pool.blobs.set("chapter.xhtml", "blob:cached");
    }
    pool.pendingUpdates.set("chapter.xhtml", { inPool: true });
    pool._currentFrame = f.manager;
    const revoke = vi.fn(); vi.stubGlobal("URL", class extends URL { static revokeObjectURL = revoke; });
    expect(await completed(pool.destroy())).toBe(true);
    expect(pool.pool.size).toBe(0);
    expect(pool.blobs.size).toBe(0);
    expect(pool.pendingUpdates.size).toBe(0);
    expect(pool.currentFrames.filter(Boolean)).toEqual([]);
    expect(injector.dispose).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:cached");
});

for (const kind of ["epub", "webpub"] as const) test(`${kind} pool finishes all releases after one frame fails`, async () => {
    const first = fixture(kind), second = fixture(kind);
    first.owner.append(second.frame.frame);
    first.loader.destroy.mockImplementation(() => { throw Error("First frame failed"); });
    const injector = { dispose: vi.fn(), releaseBlobUrl: vi.fn() };
    const pool = (kind === "epub" ? new FramePoolManager(first.owner, [], {}, injector as never)
        : new WebPubFramePoolManager(first.owner, {}, injector as never)) as any;
    pool.pool.set("first.xhtml", first.manager); pool.pool.set("second.xhtml", second.manager);
    const outcome = pool.destroy().catch((error: unknown) => error);
    expect(await completed(outcome)).toBe(true);
    expect(await outcome).toBeInstanceOf(AggregateError);
    expect(second.loader.destroy).toHaveBeenCalledOnce();
    expect(pool.pool.size).toBe(0);
    expect(injector.dispose).toHaveBeenCalledOnce();
});

test("disposing an injector does not reuse a revoked cached object URL", async () => {
    let next = 0;
    const revoke = vi.fn();
    vi.stubGlobal("URL", class extends URL {
        static createObjectURL() { return `blob:fixture-${++next}`; }
        static revokeObjectURL = revoke;
    });
    const injector = new Injector({ rules: [], allowedDomains: [] }) as any;
    const resource = { id: "style", blob: new Blob(["body {}"], { type: "text/css" }) };
    const first = await injector.getOrCreateBlobUrl(resource);
    injector.dispose();
    expect(revoke).toHaveBeenCalledWith(first);
    expect(await injector.getOrCreateBlobUrl(resource)).not.toBe(first);
    injector.dispose();
});
