import { describe, expect, it } from "vitest";
import { vimeoEmbed } from "./vimeo-embed";

describe("Vimeo video source", () => {
  it("accepts a Vimeo link and extracts the player URL from embed code", () => {
    expect(vimeoEmbed("https://vimeo.com/12345")).toBe("https://player.vimeo.com/video/12345");
    expect(vimeoEmbed('<div><iframe src="https://player.vimeo.com/video/12345?h=abcd&amp;autoplay=1"></iframe></div><script>bad()</script>')).toBe("https://player.vimeo.com/video/12345?h=abcd");
  });
  it("rejects other hosts and unsafe source URLs", () => {
    expect(vimeoEmbed('<iframe src="https://player.vimeo.com.evil.example/video/123"></iframe>')).toBeNull();
    expect(vimeoEmbed('<iframe src="javascript:alert(1)"></iframe>')).toBeNull();
    expect(vimeoEmbed("https://vimeo.com/channels/example")).toBeNull();
  });
});
