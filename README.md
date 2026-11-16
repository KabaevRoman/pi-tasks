# pi-code-tasks

Independently installable pi extension: tasks. Former package name: `pi-claude-tasks`.

This extension depends on `pi-code-core@0.5.0`; it does not require any other extension.

For a release, publish `pi-code-core` first, then this package. Install this package through pi's package manager; its npm dependencies provide the shared core automatically. For local development, use the parent npm workspace and build core before running this extension. To distribute before publication, provide both core and extension tarballs.

Feature code and resources live here. Shared runtime, prompt assets, and compatibility profile live in `pi-code-core`. Existing compatibility identifiers and saved-state paths remain unchanged.

## Publishing to npm

The `.github/workflows/publish.yml` workflow publishes this package when a tag is
pushed. Add a repository Actions secret named `NPM_TOKEN` containing an npm token
with publish access (and permission to bypass 2FA for automated publishing).

Update `package.json` to the release version, commit the change, then push a
matching tag, for example:

```sh
git tag v0.5.0
git push origin v0.5.0
```

Tags must equal the package version, optionally prefixed with `v`. The workflow
installs dependencies, builds if needed, typechecks, and runs available tests
before publishing. Stable versions use the `latest` npm dist-tag; prerelease
versions use `next`. Each version can only be published once.

Publish matching dependency versions first: `pi-code-core`, then the individual
extensions, then `pi-code-bundle`.
