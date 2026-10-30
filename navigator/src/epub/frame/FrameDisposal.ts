interface FrameResources {
    frame: HTMLIFrameElement;
    wrapper?: HTMLElement;
    conditionBridge?: { destroy(): void };
    comms?: { halt(): void };
    loader?: { destroy(): void };
}

/** Final disposal cannot depend on a message from a departing browsing context.
 * Keep graceful hide/unfocus for cached frames; terminal cleanup is local.
 */
export function disposeFrame(resources: FrameResources): void {
    const errors: unknown[] = [];
    const release = (action: () => void) => {
        try { action(); } catch (error) { errors.push(error); }
    };
    release(() => resources.frame.blur());
    release(() => resources.conditionBridge?.destroy());
    release(() => resources.comms?.halt());
    release(() => {
        resources.frame.contentDocument?.querySelectorAll<HTMLMediaElement>("audio, video")
            .forEach(media => release(() => media.pause()));
    });
    release(() => resources.loader?.destroy());
    resources.frame.onload = null;
    resources.frame.onerror = null;
    release(() => resources.frame.remove());
    release(() => resources.wrapper?.remove());
    if (errors.length) throw new AggregateError(errors, "Failed to dispose frame resources");
}
