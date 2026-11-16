# pi-code-tasks

Independently installable pi extension: tasks. Former package name: `pi-claude-tasks`.

This extension depends on `pi-code-core@0.5.0`; it does not require any other extension.

The new package name is not yet published. Publish `pi-code-core` first, then this package. Once released, install this package through pi's package manager; its npm dependencies provide the shared core automatically. For local development, use the parent npm workspace and build core before running this extension. To distribute before publication, provide both core and extension tarballs.

Feature code and resources live here. Shared runtime, prompt assets, and compatibility profile live in `pi-code-core`. Existing compatibility identifiers and saved-state paths remain unchanged.
