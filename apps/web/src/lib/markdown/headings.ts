import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import GithubSlugger from "github-slugger";
import type { Root, Heading, Text } from "mdast";

export type HeadingItem = {
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  slug: string;
};

export function extractHeadings(markdown: string): HeadingItem[] {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const slugger = new GithubSlugger();
  const headings: HeadingItem[] = [];

  visit(tree, "heading", (node: Heading) => {
    const text = node.children
      .filter((c): c is Text => c.type === "text")
      .map((c) => c.value)
      .join("");
    if (!text) return;
    headings.push({
      depth: node.depth,
      text,
      slug: slugger.slug(text),
    });
  });

  return headings;
}
