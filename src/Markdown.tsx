import { isValidElement, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import "katex/dist/katex.min.css";
import { normalizeMath } from "./markdown-math";

function CodeBlock({ children }: { children?: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const [status, setStatus] = useState("");
  const className = isValidElement<{ className?: string }>(children)
    ? children.props.className || ""
    : "";
  const language = /language-([^\s]+)/.exec(className)?.[1] || "text";
  async function copy() {
    try {
      await navigator.clipboard.writeText(pre.current?.textContent || "");
      setStatus("Copied");
    } catch {
      setStatus("Select the code to copy");
    }
  }
  return (
    <section className="code-block" aria-label={`${language} code block`}>
      <div className="code-toolbar">
        <span>{language}</span>
        <div>
          <span role="status">{status}</span>
          <button type="button" onClick={copy} aria-label="Copy code">
            {status === "Copied" ? <Check size={15} /> : <Copy size={15} />}
            Copy
          </button>
        </div>
      </div>
      <pre ref={pre} tabIndex={0} aria-label={`${language} source code`}>
        {children}
      </pre>
    </section>
  );
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            {
              trust: false,
              strict: "ignore",
              maxExpand: 1000,
              maxSize: 20,
              errorColor: "#ffc3a1",
            },
          ],
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
        ]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => <span>[Image: {alt}]</span>,
          pre: CodeBlock,
          table: ({ children }) => (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Table"
            >
              <table>{children}</table>
            </div>
          ),
          span: ({ node: _node, className, children, ...props }) => (
            <span
              {...props}
              className={className}
              {...(className === "katex-display"
                ? { tabIndex: 0, role: "region", "aria-label": "Equation" }
                : {})}
            >
              {children}
            </span>
          ),
        }}
      >
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  );
}
