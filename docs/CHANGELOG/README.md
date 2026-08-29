# Release note source contract

> **Historical note.** Per-version release-note bodies are frozen: `tools-release`
> publishes each one as an immutable object, so they are never edited after the
> release ships. Directories at and before `v0.19.1` mention OpenDesign Cloud /
> AMR and the `vela` CLI (hosted account, sign-in, wallet, team workspaces, and
> the `od amr` subcommands). That capability has since been removed; OpenDesign
> runs on local coding-agent CLIs and your own provider keys only. Read those
> files as a record of what shipped at the time, not as current behavior.

Release note content is stored under `docs/CHANGELOG/v<releaseVersion>/<locale>.md`.
The directory name must contain the exact full release version, including its
channel and counter when present. There is no fallback to a base version.

Each locale file must:

- use a canonical BCP 47 locale as its filename, such as `en.md` or `zh-CN.md`;
- be valid UTF-8 Markdown no larger than 1 MiB;
- begin with YAML front matter containing non-empty `title` and `description`
  strings; and
- contain a non-empty Markdown body after the front matter.

The `en` locale is required whenever a release-note directory is supplied.
Stable releases additionally require `zh-CN`. Other channels may omit the
version directory entirely.

`tools-release` retains the front matter in the uploaded file and publishes it
as an immutable object at
`<channel>/versions/<releaseVersion>/release-notes/<locale>.md`. Public release
metadata contains only locale transport descriptors (`url`, `mediaType`,
`sha256`, and `size`); render fields are read from the content itself.
