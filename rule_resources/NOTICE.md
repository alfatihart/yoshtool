# Filter rule attribution

`dnr-ads.json` and `dnr-trackers.json` are Chrome Manifest V3 `declarativeNetRequest` (DNR)
rulesets used by YoshTool's ad / tracker blocker (Tools → Ad & tracker blocker).

They are a **block/allow-only subset** derived from the compiled DNR rulesets shipped in the
open-source **Ghostery** browser extension (https://github.com/ghostery/ghostery-extension),
licensed under the **Mozilla Public License 2.0 (MPL-2.0)**. Rules whose actions require host
permissions (`redirect`, `modifyHeaders`) were removed so the blocker works **without** broad
host access.

Those rules are in turn compiled from community ad / tracker filter lists, notably **EasyList**
and **EasyPrivacy** (https://easylist.to), dual-licensed under **GPLv3** and **CC BY-SA 3.0**.

`cosmetics.json` holds element-hiding (cosmetic) selectors generated from **EasyList**'s
`easylist_general_hide.txt` and `easylist_specific_hide.txt` (https://easylist.to, dual-licensed
under **GPLv3** and **CC BY-SA 3.0**) and from **ABPindo** — the Indonesian/Malaysian ad-filter list
(https://github.com/ABPindo/indonesianadblockrules, **GPLv3**) — which adds regional and judol/stream
ad coverage. Scriptlet (`+js`), HTML-filtering (`^`), style-injection (`#$#`) and exception rules are
dropped; supported procedural selectors (`:has-text`/`:matches-attr`/`:matches-css`/`:upward`/
`:min-text-length`, plus aliases) are kept and the rest are validated as plain CSS (via a headless
browser) so no invalid selector ships. Only `display:none` hiding is applied. See
`scripts/build-cosmetics.mjs` to regenerate.

`dnr-redirect.json` and `redirects/*` are the "redirect blocked scripts to a neutered stub" rules
and their stub resources, also from the Ghostery extension (**MPL-2.0**); the stub files originate
from **uBlock Origin**'s web-accessible redirect resources (**GPLv3**).

`extended-blocklist.json` is a curated ~25,000-rule supplementary block pack converted from
**AdGuard**'s Base + Tracking Protection filter lists (`@adguard/dnr-rulesets`, **GPL-3.0**), applied
as dynamic rules when the user enables the optional *Extended blocklist*.

These data files are redistributed under the terms of their upstream licenses. They are **data**,
not YoshTool source code — no other part of YoshTool is covered by those licenses.

To refresh the lists, see `docs/adblock-tracker-research.md` (§3 — the ruleset is treated as
data generated/updated by a separate task, not a build step of the extension code).
