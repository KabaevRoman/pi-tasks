# @pi-ko/tasks

Independently installable pi extension: tasks.

This extension depends on `@pi-ko/core@0.5.0`; it does not require any other extension.

For a release, publish `@pi-ko/core` first, then this package. Install this package through pi's package manager; its npm dependencies provide the shared core automatically. For local development, use the parent npm workspace and build core before running this extension. To distribute before publication, provide both core and extension tarballs.

Feature code and resources live here. Shared runtime, prompt assets, and compatibility profile live in `@pi-ko/core`. Existing compatibility identifiers and saved-state paths remain unchanged.

## Publishing to npm

The `.github/workflows/publish.yml` workflow publishes this package to the public
npm registry when a tag is pushed. It authenticates with the repository secret
`NPM_TOKEN`, an npm automation or granular token that may publish the
`@pi-ko` scope. Enable GitHub Actions in this repository.

Update `package.json` to the release version, commit it, then push a matching tag:

```sh
git tag v0.5.0
git push origin v0.5.0
```

Tags must equal the package version, optionally prefixed with `v`. The workflow
installs dependencies, builds if needed, typechecks, and runs available tests
before publishing. Stable versions use `latest`; prereleases use `next`.
Each version can only be published once.

Publish matching dependency versions in order: `@pi-ko/core`, then
the individual extensions, then `@pi-ko/bundle`. Packages are
published with public access, so dependents install from the public registry
without cross-repository access setup.

## Installing from npm

The committed `.npmrc` routes `@pi-ko` packages to the public npm registry and
leaves other packages on the default registry. The packages are public, so
installing them needs no authentication. Install using the full scoped package
name.
