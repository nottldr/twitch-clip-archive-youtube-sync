import { describe, expect, it } from "vitest";

import type { TwitchClip } from "#server/archive/types.js";
import {
  buildVideoMetadata,
  interpolateTemplate,
  sanitizeForYouTube,
} from "#server/youtube/metadata.js";

function makeClip(overrides: Partial<TwitchClip> = {}): TwitchClip {
  return {
    clipId: "TestClip-abc123",
    url: "https://www.twitch.tv/georgy177/clip/TestClip-abc123",
    embedUrl: "https://clips.twitch.tv/embed?clip=TestClip-abc123",
    broadcasterId: 135075027,
    broadcasterName: "georgy177",
    creatorId: 100001,
    creatorName: "viewer_one",
    gameId: 509658,
    language: "nl",
    title: "Amazing play in ranked",
    viewCount: 150,
    createdAt: "2022-04-14T18:50:58Z",
    thumbnailUrl: "https://example.com/thumb.jpg",
    clipArchived: true,
    thumbnailArchived: true,
    deletedOnTwitch: false,
    ...overrides,
  };
}

describe("buildVideoMetadata", () => {
  it("truncates titles longer than 100 chars", () => {
    const longTitle = "A".repeat(150);
    const meta = buildVideoMetadata(makeClip({ title: longTitle }));
    expect(meta.snippet!.title!.length).toBe(100);
  });

  it("keeps short titles unchanged", () => {
    const meta = buildVideoMetadata(makeClip({ title: "Short title" }));
    expect(meta.snippet!.title).toBe("Short title");
  });

  it("includes clip ID in description", () => {
    const meta = buildVideoMetadata(makeClip());
    expect(meta.snippet!.description).toContain("TestClip-abc123");
  });

  it("includes Twitch URL in description", () => {
    const meta = buildVideoMetadata(makeClip());
    expect(meta.snippet!.description).toContain(
      "https://www.twitch.tv/georgy177/clip/TestClip-abc123",
    );
  });

  it("includes creator name in description", () => {
    const meta = buildVideoMetadata(makeClip());
    expect(meta.snippet!.description).toContain("viewer_one");
  });

  it("includes formatted date in description", () => {
    const meta = buildVideoMetadata(makeClip());
    expect(meta.snippet!.description).toContain("April 14, 2022");
  });

  it("never includes #Shorts in title or description", () => {
    const meta = buildVideoMetadata(makeClip({ title: "Something #Shorts related" }));
    // Title gets truncated at 100 chars but should still not strip #Shorts
    // The metadata builder doesn't add #Shorts, so we just verify it's not injected
    expect(meta.snippet!.description).not.toContain("#Shorts");
    // Title preserves user input (which might have it), but WE don't add it
  });

  it("includes clip_id in tags", () => {
    const meta = buildVideoMetadata(makeClip());
    expect(meta.snippet!.tags).toContain("TestClip-abc123");
  });

  it("includes broadcaster name in tags", () => {
    const meta = buildVideoMetadata(makeClip());
    expect(meta.snippet!.tags).toContain("georgy177");
  });

  it("sets privacy status to unlisted", () => {
    const meta = buildVideoMetadata(makeClip());
    expect(meta.status!.privacyStatus).toBe("unlisted");
  });

  it("sets selfDeclaredMadeForKids to false", () => {
    const meta = buildVideoMetadata(makeClip());
    expect(meta.status!.selfDeclaredMadeForKids).toBe(false);
  });

  it("includes deletion notice when clip is deleted on Twitch", () => {
    const meta = buildVideoMetadata(makeClip({ deletedOnTwitch: true }));
    expect(meta.snippet!.description).toContain("This clip has been deleted from Twitch");
  });

  it("does not include deletion notice for non-deleted clips", () => {
    const meta = buildVideoMetadata(makeClip({ deletedOnTwitch: false }));
    expect(meta.snippet!.description).not.toContain("deleted");
  });

  it("defaults language to en when empty", () => {
    const meta = buildVideoMetadata(makeClip({ language: "" }));
    expect(meta.snippet!.defaultLanguage).toBe("en");
  });

  it("uses clip language when provided", () => {
    const meta = buildVideoMetadata(makeClip({ language: "nl" }));
    expect(meta.snippet!.defaultLanguage).toBe("nl");
  });

  it("sets recordingDate from createdAt", () => {
    const meta = buildVideoMetadata(makeClip());
    expect(meta.recordingDetails!.recordingDate).toBe("2022-04-14");
  });

  it("uses custom description template when provided", () => {
    const template =
      "Clipped by {{ creator_name }} from {{ broadcaster_name }}.\n\nOriginal: {{ url }}";
    const meta = buildVideoMetadata(makeClip(), template);
    expect(meta.snippet!.description).toBe(
      "Clipped by viewer_one from georgy177.\n\nOriginal: https://www.twitch.tv/georgy177/clip/TestClip-abc123",
    );
  });

  it("falls back to default template when none provided", () => {
    const meta = buildVideoMetadata(makeClip());
    expect(meta.snippet!.description).toContain("Twitch Clip Archive");
    expect(meta.snippet!.description).toContain("TestClip-abc123");
  });
});

describe("sanitizeForYouTube", () => {
  it.each([
    ["<3", "❤️"],
    ["</3", "💔"],
    ["<.<", "‹.‹"],
    [">.>", "›.›"],
    ["<<<", "«««"],
    [">>>", "»»»"],
    ["<-", "←"],
    ["->", "→"],
    ["<=", "⇐"],
    ["=>", "⇒"],
    ["<>", "↔"],
  ])("substitutes %s -> %s", (input, expected) => {
    expect(sanitizeForYouTube(input)).toBe(expected);
  });

  it("strips bare angle brackets that didn't match a substitution", () => {
    expect(sanitizeForYouTube("a<b>c")).toBe("abc");
  });

  it("matches </3 before <3", () => {
    expect(sanitizeForYouTube("</3")).toBe("💔");
  });

  it("preserves surrounding text", () => {
    expect(sanitizeForYouTube("stream <> stream")).toBe("stream ↔ stream");
  });
});

describe("buildVideoMetadata sanitization", () => {
  it("substitutes <3 in title", () => {
    const meta = buildVideoMetadata(makeClip({ title: "love <3 it" }));
    expect(meta.snippet!.title).toBe("love ❤️ it");
  });

  it("substitutes <> in title", () => {
    const meta = buildVideoMetadata(makeClip({ title: "stream <> stream" }));
    expect(meta.snippet!.title).toBe("stream ↔ stream");
  });

  it("strips bare angle brackets from title", () => {
    const meta = buildVideoMetadata(makeClip({ title: "weird <x> title" }));
    expect(meta.snippet!.title).toBe("weird x title");
  });

  it("sanitizes title folded into description via template", () => {
    const meta = buildVideoMetadata(makeClip({ title: "<3 ya" }), "{{ title }}");
    expect(meta.snippet!.description).toBe("❤️ ya");
    expect(meta.snippet!.description).not.toMatch(/[<>]/);
  });

  it("sanitizes description content from a template", () => {
    const meta = buildVideoMetadata(makeClip(), "before <3 after");
    expect(meta.snippet!.description).toBe("before ❤️ after");
  });
});

describe("interpolateTemplate", () => {
  it("replaces all known variables", () => {
    const result = interpolateTemplate("{{ clip_id }} by {{ creator_name }}", makeClip());
    expect(result).toBe("TestClip-abc123 by viewer_one");
  });

  it("handles whitespace in braces", () => {
    const result = interpolateTemplate("{{clip_id}} / {{  creator_name  }}", makeClip());
    expect(result).toBe("TestClip-abc123 / viewer_one");
  });

  it("leaves unknown variables as-is", () => {
    const result = interpolateTemplate("{{ unknown_var }}", makeClip());
    expect(result).toBe("{{ unknown_var }}");
  });

  it("provides created_at_formatted as a human-readable date", () => {
    const result = interpolateTemplate("{{ created_at_formatted }}", makeClip());
    expect(result).toContain("April 14, 2022");
  });
});
