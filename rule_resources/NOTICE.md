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

These two JSON files are redistributed under the terms of their upstream licenses. They are
**data**, not YoshTool source code — no other part of YoshTool is covered by those licenses.

To refresh the lists, see `docs/adblock-tracker-research.md` (§3 — the ruleset is treated as
data generated/updated by a separate task, not a build step of the extension code).
