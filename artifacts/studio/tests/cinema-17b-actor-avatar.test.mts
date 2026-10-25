/**
 * KAYAN-CINEMA-17B: SSR tests for ActorAvatar component.
 * Uses react-dom/server (no jsdom). Verifies image URL construction and
 * fallback behavior.
 */
import React from "react";
import { renderToString } from "react-dom/server";
import { ActorAvatar } from "../src/components/project/actor-avatar.tsx";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? " :: " + evidence : ""}`);
  ok ? pass++ : fail++;
};

const render = (props: any) => renderToString(React.createElement(ActorAvatar, props));

// ─── A. Default path renders <img> with correct src ────────────
{
  const html = render({ actorId: 27, name: "جنى" });
  check("A1 renders <img>", html.includes("<img"));
  check("A2 src uses /api/actors/27/image", html.includes('src="/api/actors/27/image"'));
  check("A3 has data-testid=actor-avatar-image", html.includes('data-testid="actor-avatar-image"'));
  check("A4 alt contains name", html.includes('alt="جنى"'));
  check("A5 no fallback testid", !html.includes('data-testid="actor-avatar-fallback"'));
}

// ─── B. Different actorId → different src ─────────────────────
{
  const html = render({ actorId: 42 });
  check("B1 src reflects actorId=42", html.includes('src="/api/actors/42/image"'));
  check("B2 alt falls back to 'Actor 42'", html.includes('alt="Actor 42"'));
}

// ─── C. forceError → fallback (no <img>) ─────────────────────
{
  const html = render({ actorId: 27, name: "جنى", forceError: true });
  check("C1 fallback testid present", html.includes('data-testid="actor-avatar-fallback"'));
  check("C2 NO <img> tag", !html.includes("<img"));
  check("C3 contains SVG (User icon)", html.includes("<svg"));
  check("C4 aria-label mentions name", html.includes('aria-label="No image for جنى"'));
}
{
  const html = render({ actorId: 99, forceError: true });
  check("C5 aria-label mentions actor id when no name", html.includes('aria-label="No image for actor 99"'));
}

// ─── D. Size prop is applied ─────────────────────────────────
{
  const html = render({ actorId: 27, size: 64 });
  check("D1 img has 64px width", html.includes("width:64px"));
  check("D2 img has 64px height", html.includes("height:64px"));
}
{
  const html = render({ actorId: 27, size: 32, forceError: true });
  check("D3 fallback has 32px width", html.includes("width:32px"));
}

// ─── E. loading + decoding attributes present ────────────────
{
  const html = render({ actorId: 27 });
  check("E1 loading=lazy", html.includes('loading="lazy"'));
  check("E2 decoding=async", html.includes('decoding="async"'));
}

// ─── F. Custom className applied ─────────────────────────────
{
  const html = render({ actorId: 27, className: "rounded-full" });
  check("F1 className merged", html.includes("rounded-full"));
  check("F2 object-cover still present", html.includes("object-cover"));
}

console.log(`\nSUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
