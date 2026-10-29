# MCP servers

Four [MCP](https://modelcontextprotocol.io) servers. Over stdio they're registered for
this repo in `../.mcp.json`. Over HTTP they're meant for a VPS (see below). Both are plain
Node (18+) with no dependencies, so they run from a bare checkout on macOS or Linux.

| server | tool | wraps |
| :--- | :--- | :--- |
| `json2rc-server.mjs` | `json2rc` | the TypeScript converter in `players/typescript/build-json2rc` |
| `rc-render-server.mjs` | `render_rc`, `validate` | the C++/Skia headless renderer `players/cpp/tools/rc2image` |
| `deploy-server.mjs` | `package_web`, `list_pages`, `unpublish_page` | the TypeScript web player (`players/typescript`), bundled with esbuild |
| `guide-server.mjs` | `overview`, `describe` | the other two servers' own definitions: the single entry point |

**Start with `rc-guide`.** `overview` explains what each server does, when to use it (and
when not), how to connect, and which tool fits each common task. `describe` gives every
option of a server or tool, with examples (`format: "json"` returns the raw schemas). The
guide imports the servers' definitions rather than keeping a copy, so its option lists are
the schemas the servers actually accept. To add a server, export its `definition` with a
`guide` block and list it in `SERVERS` in `guide-server.mjs`. On a deployment,
`MCP_PUBLIC_BASE_URL` makes the guide show the remote endpoints.

## Setup (local)

The renderer needs `rc2image` built (`players/cpp`, see its BUILDING.md). On Linux the
configure step wants the same packages CI uses, even for a tools-only build — the prebuilt
Skia links against X11/GL, though rendering itself is CPU-only and needs no display:

```sh
sudo apt install cmake git pkg-config build-essential libfontconfig1-dev libfreetype-dev \
     libgl1-mesa-dev libglfw3-dev libx11-dev libxext-dev libxrender-dev fonts-dejavu-core
cd players/cpp
cmake -B build -DCMAKE_BUILD_TYPE=Release -DRCX_BUILD_APPS=OFF -DRCX_BUILD_TESTS=OFF
cmake --build build --target rc2image -j
```

Install at least one font: without one, Skia draws text as nothing and says nothing.

`RC2IMAGE` overrides the binary path (default `players/cpp/build/tools/rc2image/rc2image`,
then `rc2image` on PATH). `JSON2RC_DIR` overrides the converter folder; after changing
the converter sources, refresh it with `players/typescript/src/json2rc/build.sh`.

## Remote (HTTP on a VPS)

Each server also speaks MCP's Streamable HTTP transport with `--http [PORT]`. It's
stateless and answers each POST with plain JSON, without SSE. On a Debian/Ubuntu VPS,
from a checkout:

```sh
sudo mcp/deploy/setup.sh mcp.example.com
```

The domain's DNS has to point at the VPS, with ports 80 and 443 open. The script installs
the packages, builds `rc2image` under `/opt/remotecompose-experiments`, and sets up four
systemd services, `rcmcp@json2rc`, `rcmcp@rc-render`, `rcmcp@guide` and `rcmcp@deploy`. All of them run as an unprivileged
`rcmcp` user and listen on 127.0.0.1 only. Caddy sits in front and provides TLS. The
script prints the token and the endpoints:

```
https://mcp.example.com/guide/mcp
https://mcp.example.com/deploy/mcp
https://mcp.example.com/json2rc/mcp
https://mcp.example.com/rc-render/mcp
```

Run the script again after `git pull` to update. It keeps the token.

**Connecting.** In Claude Code:

```sh
claude mcp add --transport http rc-render https://mcp.example.com/rc-render/mcp \
    --header "Authorization: Bearer $TOKEN"
```

Some clients only accept a URL, such as claude.ai's custom-connector form. For those,
the token can go in the path instead: `https://mcp.example.com/rc-render/mcp/$TOKEN`.
Anyone who has that URL can use the server, so treat it like a password.

**What HTTP mode enforces:**
- **Token.** `MCP_TOKEN` is required and must be at least 24 characters. Without one the
  server refuses to start, unless `MCP_ALLOW_NO_AUTH=1` is set.
- **Workspace.** `MCP_ROOT` is required. Every path a tool takes is resolved inside it,
  and anything that leads outside it (`..`, an absolute path, a symlink) is refused.
  Paths you get back are relative to it.
- **Generated files.** Files nobody named go to `MCP_ROOT/out/` and are pruned after
  `MCP_OUT_TTL_HOURS` (24 by default).
- **Render limits.** At most `MCP_MAX_RENDERS` renders run at once (2 by default). Each
  one is killed after 120 s.
- **Origin.** If `MCP_ALLOWED_ORIGINS` is set, any request whose `Origin` isn't listed
  is refused.
- **Health check.** `GET /healthz` answers without auth.
- **Logs.** One line per tool call: `journalctl -u 'rcmcp@*' -f`.

Over HTTP you don't need paths at all. `render_rc` takes `json`, `json_path` or `rc_base64`
directly and returns the PNG inline. `json2rc` → `render_rc` by `rc_path` also works,
because both servers share the workspace.

Known gap: an `.rc` that embeds a sub-document (`rc:<file>`) is resolved by `rc2image`
relative to the document's folder, and that lookup isn't confined to the workspace. Such
a file could only be parsed as a document; nothing outside the workspace is written or
returned.

## `json2rc`

`json` (object or string) **or** `input_path`, plus optional `output_path`, `base_dir`
(where `{"file": ...}` bitmaps resolve) and `include_base64`. Returns `{rc_path, bytes}`,
plus `rc_base64` if you asked for it. Unsupported constructs
are an error naming the construct, never an approximation.

## `render_rc`

Returns one PNG (as an image, and written to `output_path` or a temp file).

| option | meaning |
| :--- | :--- |
| `rc_path` / `rc_base64` | a binary `.rc` document |
| `json` / `json_path` | a RemoteCompose JSON document, inline or as a file, converted with json2rc in-process first |
| `base_dir` | for JSON input: where `{"file": ...}` bitmaps resolve (default: `json_path`'s folder) |
| `width`, `height` | layout size the document sees (default: its own) |
| `output_width`, `output_height` | PNG resolution; the document is scaled to fit, centred |
| `density` | display density, dpi/160 (the `DENSITY` variable; font size follows) |
| `theme` | `light` or `dark` (default dark) |
| `clock` | `"HH:MM[:SS]"`, `"YYYY-MM-DD"`, `"YYYY-MM-DDTHH:MM[:SS]"` or epoch ms |
| `variables` | `{name: value}` for the document's NAMED_VARIABLEs; parsed per declared type (number, `#AARRGGBB` colour, string, number array) |
| `system_variables` | `{id: float}` raw-id overrides, e.g. `{"38": 15}` battery level |
| `touch_events` | `[{t, type: down\|move\|up\|tap, x, y, vx?, vy?}]`, document coordinates |
| `duration`, `fps` | frame-by-frame simulation length (default with events: last `t` + 0.5 s) and rate (60) |
| `animation_time` | pin animationTime for a single-frame render (not with simulation) |
| `seed` | pin `rand()` |
| `background` | `transparent` or `AARRGGBB` clear colour |

With `touch_events` or `duration`, the document runs frame by frame **with the clock
advancing**, so animation time, its delta and the wall clock agree, and a fling's easing
plays out. The captured last frame is at `clock` (or now). `up` dispatches touchUp and then
onClick, as the desktop viewer does on release. Without `vx`/`vy` the release velocity is
measured from the previous event.

The same options exist as `rc2image` flags (`--density`, `--theme`, `--var`, `--var-id`,
`--events`, `--duration`, `--fps`); run it with no arguments for the full usage.

**Image links.** Every render is returned as an MCP image block. Some clients (ChatGPT)
can't display those, so in HTTP mode with `MCP_PUBLIC_URL` set (setup.sh sets it to
`https://DOMAIN/rc-render`), the result also carries `image_url`. That's a public link to
the PNG at `MCP_PUBLIC_URL/images/<id>.png` with a 128-bit random id and no token. It
expires after `MCP_IMAGE_TTL_HOURS` (default 24). Pass `public_link: false` to skip it.

Every render also comes back with **findings**, the sanity checks listed under `validate`
below. Look at them before trusting the picture.

## `validate`

`validate` checks a document without returning an image. It takes the same document
inputs (`rc_path` / `rc_base64` / `json` / `json_path`) and the same render options as
`render_rc`, plus:
- `render` (default true): set it to false to stop after parsing and the data pass.
- `include_image`: also return the PNG from the sanity render.

It returns JSON:

| field | what |
| :--- | :--- |
| `ok` | false if any finding is an error |
| `findings` | `[{level: error\|warning\|info, code, message}]` |
| `conversion` | for JSON input: whether json2rc converted it, and the converter's error if not |
| `parse` | whether the engine parsed the `.rc`; on failure, `kind`, byte `offset`, `opcode` and `lastGoodOp` |
| `header`, `ops` | the document's size; operation counts, total and by name |
| `namedVariables` | `{name, id, type, value}`: what `variables` can set, with initial values |
| `features` | text, particles/impulses (`frameDriven`), touch, click targets, 3D |
| `fonts` | how many font families the renderer found |
| `render` | pixel stats: fraction differing from the background, distinct colours, content bounds |

Findings:

| code | level | meaning |
| :--- | :--- | :--- |
| `conversion_failed` | error | json2rc rejected the JSON (syntax error or unsupported construct) |
| `parse_unknown_opcode` / `parse_read_past_end` | error | the `.rc` doesn't parse, with where it fails |
| `render_failed` | error | rc2image refused the options, e.g. an unknown variable name |
| `no_fonts` | error | the document draws text but the server has no fonts |
| `blank` / `solid` / `nearly_blank` | warning | the image is all background, one colour, or under 0.1% changed |
| `needs_frames` | warning | particles/impulses rendered as a single frame; pass `duration` |
| `empty_document`, `no_size` | warning | no content operations; no size in the header |
| `taps_missed` | warning | taps were sent and none hit a click target |
| `renderer` | warning | a warning from rc2image itself, e.g. `move` with no `down` |
| `interactive`, `host_variables`, `small_content` | info | context (`render_rc` leaves info findings out) |

rc2image does the measuring itself (`--report FILE|-`, `--check`), and `lib/analysis.mjs`
decides what counts as suspicious, so thresholds can change without a rebuild.

## `package_web` (rc-deploy)

`package_web` turns a document (`rc_path` / `rc_base64` / `json` / `json_path`) into one
self-contained HTML page. The minified TypeScript player (about 450 KB) and the `.rc` are
both inlined, so the page works from any static host, as an attachment, or opened from
disk. Animation, touch and clicks all work.

| option | meaning |
| :--- | :--- |
| `controls` | default true: the playground page described below. `false`: the bare player, with only the document on the page |
| `layout` | `fill`: the document fills the window (or the playground's stage) and re-lays out on resize. `fixed`: a `width` x `height` CSS-px box (default: the document's own size). Default: `fill` for the bare player. The playground starts at the document's own size when it fits, and fills otherwise |
| `title`, `background` | page title; page background colour |
| `theme` | `light`, `dark` or `auto` (default `auto`, which follows the viewer's system setting) |
| `density` | `device` (default) uses the viewer's devicePixelRatio, which is sharp and right for documents authored in dp. A number pins it; use 1 for documents drawn in raw pixels, which otherwise look smaller on high-DPI screens |
| `variables` | initial host-variable values (float, int, colour, string). Unknown names are an error that lists what the document declares |
| `url_variables` | default true: `?name=value` in the page URL overrides any declared variable, so one page can show many variants |
| `publish` | host the page (default on a deployment), see below |
| `output_path` | also write the HTML file |

**The playground** (`controls`, on by default) is for seeing how a document *behaves*,
not just how it looks:

- **Size.** Drag the frame's right, bottom or corner handle, type a width and height, swap
  them, pick a preset (the document's own size, watch, phones, tablet, laptop, desktop,
  2×2 / 4×2 / 4×1 widgets), or press **Fill** to follow the window. A label shows the CSS
  size and the device pixels it lays out at.
- **Host variables.** The page has one `<rc-variable>` web component per declared variable:
  - float and int get a slider and a number field. The slider's range grows to fit what is typed.
  - colour gets a picker, an alpha slider and `#AARRGGBB` text.
  - string gets a text field.
  - long and float-array variables are shown read-only, since the web player can't set them.

  Each variable has its own reset button, and there is a **Reset all**. Edits re-run layout
  as well as paint, so a longer string or a size variable reflows the document.
- **Density, theme, Pause/Play, Restart.** Restart reloads the document, which replays
  animations and clears touch state.
- **State in the URL.** Variables that differ from their defaults go in `?name=value`, which
  the bare page reads the same way. The view goes in `#w=&h=&d=&t=` (or `#fill=1`).
  **Copy link** therefore shares exactly what is on screen, and a reload keeps it.

Before building, the C++ engine reads the document once (`rc2image --check --report`).
That rejects documents that don't parse and gets the document's size and each host
variable's type, so the page knows how to apply `variables` and URL overrides.

**Publishing.** In HTTP mode with `MCP_PUBLIC_URL` set, `package_web` also stores the page
under `MCP_ROOT/pages/` and returns `MCP_PUBLIC_URL/pages/<id>/`. That URL works **without
the token**: anyone with the link can open the page, and the 128-bit random id makes it
unguessable. Published pages are not pruned. Manage them with `list_pages` and
`unpublish_page`, which deletes a page and stops its link working immediately. Pages are
served with `noindex`, `nosniff` and `no-referrer`.

**Page index.** `https://DOMAIN/pages` (also `MCP_PUBLIC_URL/pages/`) is a public,
token-free list of every published page: title, source, kind (playground or bare player),
size and date, each linking to its page. This makes every published page discoverable,
so the random ids no longer keep anything private. To turn the index off, add
`MCP_PAGE_INDEX=0` to `/etc/rcmcp/deploy.env` and restart `rcmcp@deploy`; `/pages` then
returns 404 and unlisted links keep working.

**The player bundle** is built from `players/typescript/src/web/main.ts` into
`players/typescript/build-mcp/player.min.js` (gitignored), or `RC_PLAYER_BUNDLE`. Locally
it's rebuilt automatically whenever a player source file is newer. On a deployment the
services can't write the checkout, so `setup.sh` runs `npm ci` and
`node mcp/lib/web-player.mjs --build`. Re-run setup after pulling player changes.

The page runs the **TypeScript** engine and `render_rc` runs the **C++** one, and the two
can differ. Check the page itself, not only a `render_rc` picture.

