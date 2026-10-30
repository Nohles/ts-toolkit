# navigator

A navigator for web platforms based on the readium Navigator spec. Work is primarily based on the [kotlin toolkit](https://github.com/readium/kotlin-toolkit/tree/develop/readium/navigator/src/main/java/org/readium/r2/navigator), but adapted for the needs of the web.

To build:

```sh
pnpm run build
```

It will output 2 files (`index.js` and `index.umd.cjs`) in `dist`.

## Local lifecycle verification

From the workspace root, install with `pnpm install --frozen-lockfile`, build
with `pnpm -r build`, and run `pnpm --filter @nohles/readium-navigator test`.

The disposal tests exercise the real frame/pool classes with disconnected DOM
trees and unresponsive frame channels. Final `destroy()` releases local frame
resources without an acknowledgement from a departing iframe. Temporary
`hide()`/`unfocus()` retain their normal cached-frame acknowledgement behavior.
The EPUB navigator disconnects its resize observer and cancels queued resize
work before releasing its pool. In-progress publication loads still follow the
existing pool join path; this change does not add publication-fetch cancellation.

## Nohles local-registry release

This fork is published as `@nohles/readium-navigator`. Consumers that import
`@readium/navigator` can install the fork using an npm alias, for example:

```json
{ "@readium/navigator": "npm:@nohles/readium-navigator@2.14.0-nohles.1" }
```

Build the full workspace before packing. The packed navigator uses the matching
2.14 dependency set: shared 2.8.0, helpers 1.2.1, HTML injectables 2.9.2,
decorator 1.3.2 and guided navigation 1.2.2. Keep those model dependencies
coherent in the host and Thorium; mixing Locator class versions can break
instance checks. Publish only immutable, newly versioned tarballs to the
configured local registry; do not overwrite upstream `@readium` releases.
