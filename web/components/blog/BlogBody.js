import Link from "next/link";

import { mediaSrc } from "../../lib/media";

function isExternal(href) {
  return /^https?:\/\//i.test(href || "");
}

function InlineText({ inline }) {
  let node = inline.text;
  if (inline.italic) node = <em>{node}</em>;
  if (inline.bold) node = <strong>{node}</strong>;
  if (inline.href) {
    node = (
      <Link href={inline.href} target={isExternal(inline.href) ? "_blank" : undefined} rel={isExternal(inline.href) ? "noopener noreferrer" : undefined}>
        {node}
      </Link>
    );
  }
  return node;
}

function InlineRuns({ inlines }) {
  return (Array.isArray(inlines) ? inlines : []).map((inline, index) => <InlineText key={index} inline={inline} />);
}

export default function BlogBody({ blocks }) {
  const items = Array.isArray(blocks) ? blocks : [];
  if (!items.length) return null;
  return (
    <div className="blog-body">
      {items.map((block, index) => {
        if (block.type === "h2") return <h2 key={index}>{block.text}</h2>;
        if (block.type === "h3") return <h3 key={index}>{block.text}</h3>;
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          const listItems = Array.isArray(block.items) ? block.items : [];
          return (
            <ListTag key={index}>
              {listItems.map((inlines, itemIndex) => (
                <li key={itemIndex}>
                  <InlineRuns inlines={inlines} />
                </li>
              ))}
            </ListTag>
          );
        }
        if (block.type === "image") {
          return (
            <figure key={index} className="blog-body__figure">
              <img src={mediaSrc(block.url, 960)} alt={block.alt || ""} />
              {block.alt ? <figcaption>{block.alt}</figcaption> : null}
            </figure>
          );
        }
        if (block.type === "table") {
          const rows = Array.isArray(block.rows) ? block.rows : [];
          const [head, ...rest] = rows;
          return (
            <figure key={index} className="blog-body__table">
              {block.caption ? <figcaption>{block.caption}</figcaption> : null}
              <div className="blog-body__table-scroll">
                <table>
                  {head ? (
                    <thead>
                      <tr>
                        {head.map((cell, cellIndex) => (
                          <th key={cellIndex}>{cell}</th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody>
                    {rest.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {(row || []).map((cell, cellIndex) => (
                          <td key={cellIndex}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </figure>
          );
        }
        return (
          <p key={index}>
            <InlineRuns inlines={block.inlines} />
          </p>
        );
      })}
    </div>
  );
}

