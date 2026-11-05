import { describe, expect, it } from "vitest";
import { tildify } from "./EmptyState";

describe("tildify", () => {
  it("shows the home folder as ~", () => {
    expect(tildify("/Users/kevin/Documents")).toBe("~/Documents");
    expect(tildify("/home/kevin")).toBe("~");
    expect(tildify("C:\\Users\\kevin\\Notes")).toBe("~\\Notes");
  });
  it("leaves other paths alone", () => {
    expect(tildify("/Volumes/Notes")).toBe("/Volumes/Notes");
    expect(tildify("/Users")).toBe("/Users");
  });
});
