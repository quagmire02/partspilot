// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeInline } from "../src/components/Markdown";

describe("sanitized markdown for model text", () => {
  it("keeps emphasis and code", () => {
    expect(sanitizeInline("Connect **TRIG** to `D9`")).toBe("Connect <strong>TRIG</strong> to <code>D9</code>");
  });

  it.each([
    ["<script>alert(1)</script>step", "step"],
    ['<img src=x onerror="alert(1)">', ""],
    ["[click](javascript:alert(1))", "click"],
    ["[shop](https://evil.example)", "shop"],
    ['<a href="https://evil.example">x</a>', "x"],
    ['<span style="background:url(x)" onclick="y">hi</span>', "<span>hi</span>"],
  ])("neutralises %s", (input, out) => {
    expect(sanitizeInline(input)).toBe(out);
  });
});
