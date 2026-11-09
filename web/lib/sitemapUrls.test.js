const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

async function load() {
  return import("./sitemapUrls.js");
}

describe("blogSitemapUrls", () => {
  it("puts every published post on /blog/{slug} and skips query-section URLs", async () => {
    const { blogSitemapUrls } = await load();
    const urls = blogSitemapUrls("https://avtovozom.com", {
      posts: [
        { slug: "bmw-320li-g28-restajling-156-l-s-lgotnyj-utilsbor-i-stage-1", updated_at: "2026-10-13T06:09:21.012959" },
        { slug: "changan-uni-z-2026-1-5t-comfort-obzor-international-versii-za-2-16-mln", updated_at: "2026-10-13T05:35:04.094054" },
      ],
      sections: ["obzory-modelej", "obsluzhivanie-i-to"],
      authors: ["redaktsiya"],
    });
    const locs = urls.map((u) => u.loc);
    assert.equal(locs.filter((l) => l.includes("/blog/")).filter((l) => !l.includes("/authors/") && !l.endsWith("/sections")).length, 2);
    assert.ok(locs.includes("https://avtovozom.com/blog/bmw-320li-g28-restajling-156-l-s-lgotnyj-utilsbor-i-stage-1"));
    assert.ok(locs.includes("https://avtovozom.com/blog/changan-uni-z-2026-1-5t-comfort-obzor-international-versii-za-2-16-mln"));
    assert.ok(locs.includes("https://avtovozom.com/blog/sections"));
    assert.ok(locs.includes("https://avtovozom.com/blog/authors/redaktsiya"));
    assert.equal(locs.some((l) => l.includes("?section=")), false);
    assert.equal(urls[0].lastmod, "2026-10-13");
  });

  it("skips empty slugs so a partial API payload still emits the rest", async () => {
    const { blogSitemapUrls } = await load();
    const urls = blogSitemapUrls("https://avtovozom.com", {
      posts: [{ slug: "" }, { slug: "import2027" }, null],
      authors: [""],
    });
    assert.deepEqual(
      urls.map((u) => u.loc),
      ["https://avtovozom.com/blog/import2027", "https://avtovozom.com/blog/sections"]
    );
  });
});
