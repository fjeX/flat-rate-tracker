import { describe, it, expect } from "vitest";
import { decideAuthRedirect } from "./proxy-routes";

/**
 * Route reachability, both auth states.
 *
 * These exist because on 2026-08-14 a signed-in user was deadlocked out of
 * /forgot-password: it sat in AUTH_PAGES, which bounces signed-in visitors to
 * /dashboard, and clicking any recovery link signs you in. tsc, eslint, 791
 * unit tests and the deploy smoke all passed. The rule was correct in
 * isolation and wrong in combination, which is precisely what a table of
 * route × state catches and a type checker never will.
 */

const OUT = false;
const IN = true;

describe("decideAuthRedirect", () => {
  describe("protected routes require a session", () => {
    const protectedRoutes = [
      "/dashboard",
      "/log",
      "/history",
      "/timer",
      "/pay-period",
      "/pay-period/dispute-pack",
      "/insights",
      "/op-codes",
      "/schedule",
      "/settings",
      "/account",
      "/snapshots",
      "/admin/bugs",
    ];

    for (const route of protectedRoutes) {
      it(`${route} → /signin when signed out`, () => {
        expect(decideAuthRedirect(route, OUT)).toBe("/signin");
      });
      it(`${route} passes through when signed in`, () => {
        expect(decideAuthRedirect(route, IN)).toBeNull();
      });
    }
  });

  describe("auth pages are signed-out only", () => {
    for (const route of ["/signin", "/signup"]) {
      it(`${route} passes through when signed out`, () => {
        expect(decideAuthRedirect(route, OUT)).toBeNull();
      });
      it(`${route} → /dashboard when signed in`, () => {
        expect(decideAuthRedirect(route, IN)).toBe("/dashboard");
      });
    }
  });

  /**
   * THE REGRESSION THIS FILE WAS WRITTEN FOR.
   *
   * Both recovery pages must pass through in BOTH states, for different
   * reasons, and getting either wrong breaks a locked-out user specifically:
   *
   *   /forgot-password — signed-in must work, because clicking any reset link
   *     signs you in, and the first thing a user does with a spent link is ask
   *     for another one.
   *   /reset-password — signed-in must work, because exchanging the recovery
   *     code creates a session; a bounce here fires one step before the user
   *     sets the password they came for.
   */
  describe("recovery pages pass through in BOTH states", () => {
    for (const route of ["/forgot-password", "/reset-password"]) {
      it(`${route} passes through when signed out`, () => {
        expect(decideAuthRedirect(route, OUT)).toBeNull();
      });
      it(`${route} passes through when signed IN (the 2026-08-14 deadlock)`, () => {
        expect(decideAuthRedirect(route, IN)).toBeNull();
      });
    }

    it("query strings and trailing segments do not change the verdict", () => {
      expect(decideAuthRedirect("/reset-password", IN)).toBeNull();
      expect(decideAuthRedirect("/forgot-password", IN)).toBeNull();
    });
  });

  describe("guest mode is reachable in both states", () => {
    for (const route of ["/guest", "/guest/log", "/guest/history", "/guest/timer"]) {
      it(`${route} signed out`, () => {
        expect(decideAuthRedirect(route, OUT)).toBeNull();
      });
      it(`${route} signed in`, () => {
        expect(decideAuthRedirect(route, IN)).toBeNull();
      });
    }
  });

  describe("auth callback passes through unauthenticated", () => {
    // The user has no cookie yet when they land here — it is the handler that
    // sets one. A redirect would break OAuth and email confirmation together.
    it("/auth/callback signed out", () => {
      expect(decideAuthRedirect("/auth/callback", OUT)).toBeNull();
    });
    it("/auth/callback signed in", () => {
      expect(decideAuthRedirect("/auth/callback", IN)).toBeNull();
    });
  });

  describe("the landing page", () => {
    it("is public when signed out", () => {
      expect(decideAuthRedirect("/", OUT)).toBeNull();
    });
    it("sends a signed-in user to the app", () => {
      expect(decideAuthRedirect("/", IN)).toBe("/dashboard");
    });
    it("matches EXACTLY — '/' must not make every route public", () => {
      // PUBLIC_ROUTES uses === while every other group uses startsWith. If "/"
      // were ever switched to a prefix match, every protected route would
      // become reachable signed-out and this is the only thing that would say
      // so.
      expect(decideAuthRedirect("/dashboard", OUT)).toBe("/signin");
      expect(decideAuthRedirect("/settings", OUT)).toBe("/signin");
    });
  });

  describe("prefix matching does not leak", () => {
    // "/signin" is a prefix of "/signin-something". These are not real routes
    // today; the assertions pin the CURRENT behaviour so that adding one and
    // silently inheriting auth-page semantics shows up as a failing test
    // rather than as a redirect nobody expected.
    it("/signin-help inherits auth-page semantics (prefix match)", () => {
      expect(decideAuthRedirect("/signin-help", IN)).toBe("/dashboard");
    });
    it("an unknown route is protected", () => {
      expect(decideAuthRedirect("/definitely-not-a-route", OUT)).toBe("/signin");
      expect(decideAuthRedirect("/definitely-not-a-route", IN)).toBeNull();
    });
  });
});
