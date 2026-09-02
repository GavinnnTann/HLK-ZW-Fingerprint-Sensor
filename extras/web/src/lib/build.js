// Build identity, injected by vite.config.js at build time.
//
// The version tracks the repository's release line (the same number as
// library.properties and the GitHub releases), so "what's new" in the app and
// the release notes on GitHub always refer to the same thing. The commit is
// what actually distinguishes two builds: the tester deploys on every push to
// main, so a page can be several commits ahead of the last tag.

export const APP_VERSION = __APP_VERSION__;
export const BUILD_SHA = __BUILD_SHA__;
export const BUILD_DATE = __BUILD_DATE__;

/** Single-line identity for the header tooltip and problem reports. */
export const BUILD_ID = `v${APP_VERSION}+${BUILD_SHA} (${BUILD_DATE})`;
