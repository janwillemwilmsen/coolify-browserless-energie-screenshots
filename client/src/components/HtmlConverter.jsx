import { useState } from "react";

export default function HtmlConverter() {
  const [htmlInput, setHtmlInput] = useState("");
  const [jsonOutput, setJsonOutput] = useState("");

  const convertHtmlToJson = () => {
    if (!htmlInput.trim()) {
      setJsonOutput("[]");
      return;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlInput, "text/html");
    
    // Find all potentially interactive elements
    const elements = Array.from(doc.querySelectorAll("a, button, input, select, textarea, [role='button'], [role='link'], [data-testid], [data-test-id], [data-automation-id], [wlautomationid]"));
    const steps = [];

    elements.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role");
      const type = el.getAttribute("type") || "";
      const text = (el.textContent || el.innerText || el.value || "").trim();

      // Skip hidden inputs
      if (tag === "input" && type.toLowerCase() === "hidden") return;

      let locatorType = "css";
      let selector = "";
      
      // Determine Action Type
      let actionType = "click";
      if (tag === "input" && ["text", "password", "email", "number", "search", "tel", "url"].includes(type.toLowerCase())) {
        actionType = "type";
      } else if (tag === "textarea") {
        actionType = "type";
      }

      // Priority 1: Test IDs and Automation Attributes
      const testId = el.getAttribute("data-testid") || el.getAttribute("data-test-id");
      const autoId = el.getAttribute("data-automation-id") || el.getAttribute("wlautomationid");
      
      if (testId) {
        locatorType = "testid";
        selector = testId;
      } else if (autoId) {
        locatorType = "css";
        selector = el.hasAttribute("data-automation-id") 
          ? `[data-automation-id='${autoId}']` 
          : `[wlautomationid='${autoId}']`;
      } 
      // Priority 2: Label (for inputs)
      else if (actionType === "type") {
        let labelText = "";
        if (el.id) {
          const label = doc.querySelector(`label[for="${el.id}"]`);
          if (label) labelText = (label.textContent || "").trim();
        }
        if (!labelText) {
          const wrapperLabel = el.closest("label");
          if (wrapperLabel) labelText = (wrapperLabel.textContent || "").replace(text, "").trim();
        }
        
        if (labelText) {
          locatorType = "label";
          selector = labelText;
        } 
        // Priority 3: Placeholder
        else if (el.getAttribute("placeholder")) {
          locatorType = "placeholder";
          selector = el.getAttribute("placeholder");
        }
      }
      // Priority 4: Role (for buttons and links)
      else if (tag === "button" || role === "button" || (tag === "input" && ["button", "submit", "reset"].includes(type.toLowerCase()))) {
        locatorType = "role";
        const name = text || el.getAttribute("value") || el.getAttribute("aria-label");
        selector = name ? ["button", { name }] : "button";
      } else if (tag === "a" || role === "link") {
        locatorType = "role";
        const name = text || el.getAttribute("aria-label") || el.getAttribute("title");
        selector = name ? ["link", { name }] : "link";
      }
      // Priority 5: Alt / Title
      else if (el.getAttribute("alt")) {
        locatorType = "alt";
        selector = el.getAttribute("alt");
      } else if (el.getAttribute("title")) {
        locatorType = "title";
        selector = el.getAttribute("title");
      }
      
      // Fallback: CSS
      if (!selector) {
        locatorType = "css";
        if (el.id) {
          selector = `[id='${el.id}']`;
        } else if (el.getAttribute("name")) {
          selector = `[name='${el.getAttribute("name")}']`;
        } else {
          selector = tag;
          if (el.className && typeof el.className === "string") {
            const classes = el.className.split(" ").filter(c => c && !c.includes("ng-")).slice(0, 2);
            if (classes.length) selector += `.${classes.join(".")}`;
          }
        }
      }

      const step = {
        type: actionType,
        locatorType,
        selector
      };

      if (actionType === "type") {
        step.value = ""; // Empty value for user to fill
      }

      steps.push(step);
    });

    setJsonOutput(JSON.stringify(steps, null, 2));
  };

  return (
    <div>
      <div className="compare-header">
        <a href="#" className="btn btn-ghost" onClick={(e) => { e.preventDefault(); window.location.hash = "#admin"; }}>
          ← Back to Admin
        </a>
        <h2>HTML to JSON Converter</h2>
      </div>

      <div style={{ padding: "20px" }}>
        <p style={{ marginBottom: "20px", color: "var(--text-muted)" }}>
          Paste raw HTML snippets (like a form or a button). The converter will automatically extract interactive elements and generate Playwright JSON actions using the most accessible locators available.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div>
            <h3>Raw HTML</h3>
            <textarea
              value={htmlInput}
              onChange={(e) => setHtmlInput(e.target.value)}
              placeholder="<button>Click Me</button>"
              style={{ width: "100%", height: "400px", fontFamily: "monospace", padding: "10px", background: "var(--bg-body)", color: "var(--text-main)", border: "1px solid var(--border)", borderRadius: "4px" }}
            />
          </div>

          <div>
            <h3>Generated JSON</h3>
            <textarea
              value={jsonOutput}
              readOnly
              style={{ width: "100%", height: "400px", fontFamily: "monospace", padding: "10px", background: "var(--bg-body)", color: "var(--text-main)", border: "1px solid var(--border)", borderRadius: "4px", whiteSpace: "pre" }}
            />
          </div>
        </div>

        <div style={{ marginTop: "20px" }}>
          <button className="btn btn-primary" onClick={convertHtmlToJson}>
            Convert to JSON
          </button>
        </div>

        {/* ── AI Fallback Instructions ── */}
        <div style={{ marginTop: "40px", padding: "20px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "8px" }}>
          <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: "10px" }}>
            🤖 AI Fallback 
            <a href="https://gemini.google.com" target="_blank" rel="noreferrer" style={{ fontSize: "0.9rem", color: "var(--primary)" }}>
              Open Gemini ↗
            </a>
          </h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "15px" }}>
            If the element is heavily nested, uses dynamic IDs (like Angular's <code>_ngcontent</code>), or lacks standard accessibility tags, the auto-converter might struggle. Copy and paste this exact prompt into an AI like Gemini alongside your HTML snippet to generate an advanced, highly resilient Playwright CSS selector (e.g. using <code>:has-text()</code> or <code>:has()</code>).
          </p>
          <pre style={{ 
            background: "var(--bg-body)", 
            padding: "15px", 
            borderRadius: "4px", 
            border: "1px solid var(--border)", 
            fontSize: "0.85rem",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          }}>
{`**System Context:**
I am building a web automation scenario using a custom JSON engine powered by Playwright. I need you to help me find the most resilient, bulletproof locator for a specific element in an HTML snippet.

**Engine Constraints:**
1. The engine automatically pierces Shadow DOM boundaries, so you do not need to worry about shadow roots.
2. The engine requires the output to be a single JSON step object with \`type\`, \`locatorType\`, and \`selector\`.
3. Valid \`locatorType\` values map directly to Playwright APIs:
   - "role" (e.g., ["button", {"name": "Submit"}])
   - "text" (getByText)
   - "label" (getByLabel)
   - "placeholder" (getByPlaceholder)
   - "alt" (getByAltText)
   - "title" (getByTitle)
   - "testid" (getByTestId)
   - "css" (Playwright's advanced CSS engine)

**Instructions:**
Please look at the HTML snippet below. I want to interact with the primary input/button. 
1. If the element lacks explicit accessibility attributes or has a dynamic/random ID, do **not** use a fragile selector. 
2. Instead, use Playwright's advanced CSS pseudo-classes (like \`crnt-text-input:has-text('kWh') input\` or \`:has()\`) to anchor the selector to nearby static text or icons.
3. Output ONLY the JSON object for the step, followed by a 1-sentence explanation of why you chose that selector.

**Action to perform:** [ CLICK / TYPE "hello" / WAIT FOR VISIBLE ]
**HTML Snippet:**
[ PASTE RAW HTML HERE ]`}
          </pre>
        </div>
      </div>
    </div>
  );
}
