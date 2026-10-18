# Releases

Since v1.32.86 (2026-10-18) releases live in the public repo
**amiablet21/capture-station-releases**, not here. The app's updater
(`UPDATE_REPO` in `src/main/main.js` and `build.publish` in `package.json`)
reads that repo, so this repo can be private.

## Cutting a release

Same as before: bump `version` in `package.json`, then on this repo's
Actions tab run **Build Windows app** and **Build Mac app** on the branch
with `release_tag` = `v<version>` (or push the tag). Each one tags the
commit here and starts the **Build** workflow in capture-station-releases,
which checks this commit out, builds, and publishes the release there.
Watch the builds on the releases repo's Actions tab.

The builds run in the public repo because its Actions minutes are free; at
~125 releases a month a private repo would overrun its 2,000 free minutes
(macOS minutes count 10x).

## Secrets

One fine-grained token, saved as `RELEASE_BOT_TOKEN` in **both** repos:
repository access capture-station + capture-station-releases, permissions
Contents: read-only and Actions: read and write. When it expires the
"Start the build" step fails with a clear error; make a new one and update
both secrets.

## Files

- `.github/workflows/build-windows.yml`, `build-mac.yml`: start the build
- `.github/workflows/copy-release-here.yml`: one-off for the switch, copies
  v1.32.86 back here so stations on v1.32.85 or older can reach it
- `tools/release-repo/`: master copy of what lives in
  capture-station-releases (README, `build.yml`, `publish-release.yml`);
  edit here, then copy over
