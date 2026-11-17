/** Position windows use strict preload bounds and inclusive retention bounds.
 * A resource can occur both far away and nearby; preload always wins. */
export function framePoolWindow(
    positions: readonly { href: string }[],
    currentIndex: number,
    retentionDistance: number,
    preloadDistance: number,
): { creation: string[]; disposal: string[] } {
    const creation = new Set<string>();
    const disposal = new Set<string>();
    for (let index = 0; index < positions.length; index++) {
        const href = positions[index].href;
        if (index > currentIndex + retentionDistance || index < currentIndex - retentionDistance) disposal.add(href);
        if (index < currentIndex + preloadDistance && index > currentIndex - preloadDistance) creation.add(href);
    }
    return { creation: [...creation], disposal: [...disposal].filter(href => !creation.has(href)) };
}
