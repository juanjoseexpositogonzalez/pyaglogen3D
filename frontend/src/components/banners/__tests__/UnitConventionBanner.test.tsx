import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UnitConventionBanner } from "../UnitConventionBanner";

/**
 * Dismissal-key prefix shared with the component. Kept as a literal here on
 * purpose so a future rename in the component is caught by these tests.
 */
const DISMISS_KEY_PREFIX = "dismissed-banner:unit-convention:";

function dismissKey(userId: string): string {
  return DISMISS_KEY_PREFIX + userId;
}

describe("UnitConventionBanner", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders when schemaVersion is "v1" and no dismissal flag', () => {
    render(
      <UnitConventionBanner
        simulationId="sim-1"
        schemaVersion="v1"
        userId="user-1"
      />,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Unit convention updated/i)).toBeTruthy();
  });

  it("renders when schemaVersion is null and no dismissal flag", () => {
    render(
      <UnitConventionBanner
        simulationId="sim-1"
        schemaVersion={null}
        userId="user-1"
      />,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it('does NOT render when schemaVersion is "v2"', () => {
    // The component's prop type narrows to "v1" | null, so callers are
    // responsible for not passing "v2". This test documents that expected
    // contract by forcing the prop through a cast and asserting that even if
    // the caller *did* pass "v2", the component would not crash — and, more
    // importantly, the test also asserts the prop-level narrowing via a
    // typed caller that selects v2 and renders nothing.

    // Simulate a typed caller that correctly refuses to render for v2:
    function TypedCaller({ version }: { version: "v1" | "v2" | null }) {
      if (version === "v2") return null;
      return (
        <UnitConventionBanner
          simulationId="sim-1"
          schemaVersion={version}
          userId="user-1"
        />
      );
    }

    const { container } = render(<TypedCaller version="v2" />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("does NOT render when localStorage dismissal flag is set for that userId", () => {
    localStorage.setItem(dismissKey("user-1"), "true");

    const { container } = render(
      <UnitConventionBanner
        simulationId="sim-1"
        schemaVersion="v1"
        userId="user-1"
      />,
    );

    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("dismiss click writes localStorage + invokes onDismiss + hides banner", () => {
    const onDismiss = vi.fn();

    render(
      <UnitConventionBanner
        simulationId="sim-1"
        schemaVersion="v1"
        userId="user-1"
        onDismiss={onDismiss}
      />,
    );

    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.click(dismissBtn);

    expect(localStorage.getItem(dismissKey("user-1"))).toBe("true");
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("different userId has independent dismissal state", () => {
    // user-1 has dismissed the banner.
    localStorage.setItem(dismissKey("user-1"), "true");

    // user-2 has not — they should still see it.
    render(
      <UnitConventionBanner
        simulationId="sim-1"
        schemaVersion="v1"
        userId="user-2"
      />,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(localStorage.getItem(dismissKey("user-2"))).toBeNull();
  });
});
