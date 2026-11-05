import { test } from "node:test";
import assert from "node:assert/strict";
import { isRejectText } from "../adblock-consent-core.js";

test("isRejectText matches reject labels", () => {
  for (const s of [
    "Reject all", "Reject All Cookies", "Decline", "Refuse all", "Deny",
    "Disagree", "Only necessary", "Necessary only", "Essential cookies only",
    "Continue without accepting", "Continue without agreeing", "Tolak semua",
  ]) assert.ok(isRejectText(s), `should match: ${s}`);
});

test("isRejectText rejects accept / neutral labels", () => {
  for (const s of [
    "Accept all", "Accept All Cookies", "I Agree", "Agree & close", "Allow all",
    "Enable all", "Got it", "OK", "Manage options", "Customize", "Settings",
    "Learn more", "Save preferences", "Setuju", "", "   ",
  ]) assert.ok(!isRejectText(s), `should NOT match: ${s}`);
});

test("isRejectText ignores overly long text (not a button label)", () => {
  assert.ok(!isRejectText("We use cookies to reject and decline tracking across this very long sentence"));
});
