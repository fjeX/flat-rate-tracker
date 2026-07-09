import fs from "node:fs";
import { test, expect, AUTH_STATE } from "./fixtures";
import { ROUTES } from "./routes";

/**
 * Mechanical UI-quality assertions — the symptoms Liem used to hunt by hand,
 * checked on every route in every theme/width:
 *
 *   1. no horizontal overflow (page or inside cards)
 *   2. no text clipped by its container (ellipsis-less horizontal cutoff)
 *   3. keyboard focus lands on elements with a visible focus ring
 *   4. touch targets ≥ 44×44 on mobile (invisible ::after expanders count)
 */
for (const route of ROUTES) {
  test.describe(route.name, () => {
    if (route.auth) {
      test.skip(!fs.existsSync(AUTH_STATE), "no bot session — run auth setup");
      test.use({ storageState: AUTH_STATE });
    }

    test.beforeEach(async ({ page }) => {
      await page.goto(route.path);
      await page.waitForLoadState("networkidle");
      // dev server compiles CSS on demand — don't assert against a page
      // that hasn't received the design system yet
      await page.waitForFunction(
        () => getComputedStyle(document.documentElement).getPropertyValue("--tap-min").trim() === "44px",
        undefined,
        { timeout: 15_000 },
      );
    });

    test("no horizontal overflow", async ({ page }) => {
      const overflows = await page.evaluate(() => {
        const bad: string[] = [];
        if (document.body.scrollWidth > document.documentElement.clientWidth + 1) {
          bad.push(`body: ${document.body.scrollWidth} > ${document.documentElement.clientWidth}`);
        }
        for (const el of document.querySelectorAll<HTMLElement>(".card, .card-inset, .step-card")) {
          const cs = getComputedStyle(el);
          if (cs.overflowX !== "visible") continue; // scroll containers are fine
          if (el.scrollWidth > el.clientWidth + 2) {
            bad.push(`${el.className.split(" ")[0]}: ${el.scrollWidth} > ${el.clientWidth}`);
          }
        }
        return bad;
      });
      expect(overflows, overflows.join("; ")).toEqual([]);
    });

    test("no clipped text", async ({ page }) => {
      const clipped = await page.evaluate(() => {
        const bad: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let node = walker.nextNode() as HTMLElement | null;
        while (node) {
          const el = node;
          node = walker.nextNode() as HTMLElement | null;
          if (!el.childNodes.length) continue;
          const hasDirectText = Array.from(el.childNodes).some(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim().length > 0,
          );
          if (!hasDirectText) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none") continue;
          // screen-reader-only text is clipped BY DESIGN
          if (el.className.toString().includes("sr-only")) continue;
          if (el.clientWidth <= 2 || cs.clipPath !== "none" || cs.clip !== "auto") continue;
          // horizontal cutoff without an intentional ellipsis
          if (
            (cs.overflowX === "hidden" || cs.overflow === "hidden") &&
            cs.textOverflow !== "ellipsis" &&
            el.scrollWidth > el.clientWidth + 2
          ) {
            bad.push(`<${el.tagName.toLowerCase()} class="${el.className}"> "${el.textContent!.trim().slice(0, 40)}"`);
          }
        }
        return bad;
      });
      expect(clipped, clipped.join("; ")).toEqual([]);
    });

    test("keyboard focus is visible", async ({ page }) => {
      const missing: string[] = [];
      const seen = new Set<string>();
      // Tab through the first 15 stops; each focused element must show a ring.
      // Elements are assessed once — date inputs expose several internal Tab
      // stops (m/d/y + picker icon) and the picker stop reports the host
      // element without its focus styling.
      for (let i = 0; i < 15; i++) {
        await page.keyboard.press("Tab");
        const res = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return { done: true as const };
          // Next.js dev overlay portal is not part of the app UI
          if (el.tagName.includes("-")) return { done: false as const, visible: true, desc: "" };
          const ringOn = (n: Element) => {
            const c = getComputedStyle(n as HTMLElement);
            return (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0) || c.boxShadow !== "none";
          };
          let visible = ringOn(el);
          // composite controls show the ring on a focus-within wrapper
          let anc: Element | null = el.parentElement;
          for (let d = 0; d < 3 && anc && !visible; d++, anc = anc.parentElement) {
            if (ringOn(anc)) visible = true;
          }
          return {
            done: false as const,
            visible,
            desc: `<${el.tagName.toLowerCase()} class="${el.className}">`,
          };
        });
        if (res.done) break;
        if (seen.has(res.desc)) continue;
        seen.add(res.desc);
        if (!res.visible) missing.push(res.desc);
      }
      expect(missing, `no focus ring on: ${missing.join("; ")}`).toEqual([]);
    });

    test("touch targets ≥ 44px on mobile", async ({ page }, testInfo) => {
      test.skip(!testInfo.project.name.endsWith("mobile"), "mobile-only requirement");
      const small = await page.evaluate(() => {
        const MIN = 44;
        const bad: string[] = [];
        const els = document.querySelectorAll<HTMLElement>(
          'button, a[href], input:not([type="hidden"]), select, [role="button"]',
        );
        for (const el of els) {
          const label = el.closest("label");
          const target = (label as HTMLElement) ?? el;
          const r = target.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue; // hidden
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden") continue;
          // inline text links inside prose are exempt (WCAG inline exception)
          if (el.tagName === "A" && cs.display === "inline") continue;
          // account for invisible ::after tap-area expanders (.hit-expand pattern)
          let w = r.width;
          let h = r.height;
          const after = getComputedStyle(el, "::after");
          if (after.content !== "none" && after.position === "absolute") {
            const inset = parseFloat(after.top);
            if (!Number.isNaN(inset) && inset < 0) {
              w += Math.abs(inset) * 2;
              h += Math.abs(inset) * 2;
            }
          }
          if (w < MIN - 1 || h < MIN - 1) {
            bad.push(
              `<${el.tagName.toLowerCase()} class="${el.className.toString().split(" ").slice(0, 3).join(" ")}"> ${Math.round(w)}×${Math.round(h)}`,
            );
          }
        }
        return bad;
      });
      expect(small, `under 44px: ${small.join("; ")}`).toEqual([]);
    });
  });
}
