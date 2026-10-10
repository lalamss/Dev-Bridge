import { describe, expect, it } from "vitest";
import { filterIdentities } from "./ComponentsView";
import { filterFiles } from "./FilesView";

/**
 * Search/filter coverage for the Components and Files views.
 * Pure helpers — no DOM needed.
 */

const identities = [
  { id: "dvi_aaaa", component: "Hero", source: { file: "src/components/Hero.tsx" } },
  { id: "dvi_bbbb", component: null, source: { file: "src/pages/Dashboard.tsx" } },
  { id: "dvi_cccc", component: "Footer", source: { file: "src/components/Footer.tsx" } },
];

describe("view filtering", () => {
  it("matches components by name, id, or file", () => {
    expect(filterIdentities(identities, "hero")).toHaveLength(1);
    expect(filterIdentities(identities, "dvi_bbbb")).toHaveLength(1);
    expect(filterIdentities(identities, "dashboard")).toHaveLength(1);
    expect(filterIdentities(identities, "src/components")).toHaveLength(2);
  });

  it("returns everything on a blank query and nothing on a miss", () => {
    expect(filterIdentities(identities, "  ")).toHaveLength(3);
    expect(filterIdentities(identities, "nope")).toHaveLength(0);
  });

  it("filters files by path substring, case-insensitively", () => {
    const files = ["src/App.tsx", "src/pages/Dashboard.tsx", "src/styles.css"];
    expect(filterFiles(files, "DASH")).toEqual(["src/pages/Dashboard.tsx"]);
    expect(filterFiles(files, "src/")).toHaveLength(3);
    expect(filterFiles(files, "nope")).toHaveLength(0);
  });
});
