import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { simulationsApi, ApiError } from "@/lib/api";

// -----------------------------------------------------------------------------
// These tests drive `simulationsApi.exportProjections` through its sync and
// async code paths. We mock `global.fetch` because that's what `authFetch`
// ultimately calls — no need to stub `authFetch` itself (it just adds
// auth headers, which we don't care about here).
// -----------------------------------------------------------------------------

const PROJECT_ID = "project-xyz";
const SIM_ID = "sim-abc";

/** Build a Response-like object that the `fetch` mock can return. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function zipResponse(status = 200): Response {
  const blob = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], {
    type: "application/zip",
  });
  return new Response(blob, {
    status,
    headers: { "Content-Type": "application/zip" },
  });
}

describe("simulationsApi.exportProjections", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the Blob directly on the 200 sync path", async () => {
    fetchMock.mockResolvedValueOnce(zipResponse(200));

    const blob = await simulationsApi.exportProjections(
      PROJECT_ID,
      SIM_ID,
      { mode: "grid", n_az: 4, n_el: 3 },
    );

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/zip");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      `/projects/${PROJECT_ID}/simulations/${SIM_ID}/projection/batch/`,
    );
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toContain('"mode":"grid"');
  });

  it("polls the status endpoint on 202 and resolves with the downloaded blob", async () => {
    // Sequence:
    //   1. POST /projection/batch/  → 202 { job_id }
    //   2. GET  /projections-status/<id>/ → processing (progress 0.3)
    //   3. GET  /projections-status/<id>/ → done { download_url }
    //   4. GET  <download_url>         → zip blob
    fetchMock
      .mockResolvedValueOnce(jsonResponse(202, { job_id: "job-1", status: "queued" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "processing",
          progress: 0.3,
          current: 60,
          total: 200,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "done",
          download_url: "/api/v1/projections-status/job-1/download/",
        }),
      )
      .mockResolvedValueOnce(zipResponse(200));

    const onProgress = vi.fn();
    const blob = await simulationsApi.exportProjections(
      PROJECT_ID,
      SIM_ID,
      { mode: "fibonacci", n: 500 },
      { onProgress, pollIntervalMs: 1, maxWaitMs: 5000 },
    );

    expect(blob).toBeInstanceOf(Blob);
    // Initial POST + 2 status polls + 1 download = 4 fetches.
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // onProgress called for the "processing" tick with the exact payload fields.
    expect(onProgress).toHaveBeenCalledWith(0.3, 60, 200);

    // Verify the status URL hit the right path.
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "/projections-status/job-1/",
    );
    // Download URL was resolved against API_BASE (prefix stripped).
    const downloadUrl = String(fetchMock.mock.calls[3][0]);
    expect(downloadUrl).toContain("/projections-status/job-1/download/");
  });

  it("rejects with ApiError when the backend returns 400", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { detail: "n_el must be >= 2" }),
    );

    await expect(
      simulationsApi.exportProjections(PROJECT_ID, SIM_ID, {
        mode: "grid",
        n_az: 1,
        n_el: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects with ApiError when async status returns failed", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(202, { job_id: "job-fail" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: "failed",
          error: "pyo3 panic in generate_direction_fibonacci",
        }),
      );

    await expect(
      simulationsApi.exportProjections(
        PROJECT_ID,
        SIM_ID,
        { mode: "fibonacci", n: 9999 },
        { pollIntervalMs: 1 },
      ),
    ).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining("pyo3 panic"),
    });
  });

  it("times out when processing never completes", async () => {
    // Always respond with 202 → processing, never "done".
    fetchMock.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/projection/batch/")) {
        return jsonResponse(202, { job_id: "job-slow" });
      }
      return jsonResponse(200, {
        status: "processing",
        progress: 0.1,
        current: 10,
        total: 100,
      });
    });

    // Super-tight timeout so the test finishes quickly.
    await expect(
      simulationsApi.exportProjections(
        PROJECT_ID,
        SIM_ID,
        { mode: "fibonacci", n: 500 },
        { pollIntervalMs: 1, maxWaitMs: 20 },
      ),
    ).rejects.toMatchObject({ status: 408 });
  });

  it("rejects with 502 when the async path returns 202 but no job_id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(202, {}));

    await expect(
      simulationsApi.exportProjections(PROJECT_ID, SIM_ID, {
        mode: "fibonacci",
        n: 500,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
