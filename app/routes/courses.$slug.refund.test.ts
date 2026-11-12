import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let currentUserId: number | null = null;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

vi.mock("~/lib/session", () => ({
  getCurrentUserId: async () => currentUserId,
}));

import { action } from "./courses.$slug.refund";

function raiseRefundRequest(slug: string) {
  const formData = new FormData();
  formData.set("reason", "The course was not what I expected.");
  const request = new Request(`http://localhost/courses/${slug}/refund`, {
    method: "POST",
    body: formData,
  });
  return action({ request, params: { slug }, context: {} } as never);
}

describe("raising a Refund Request", () => {
  let logged: string[];

  beforeEach(() => {
    testDb = createTestDb();
    logged = [];
    vi.spyOn(console, "log").mockImplementation((message: unknown) => {
      logged.push(String(message));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refunds the amount paid on the Purchase, not the List Price", async () => {
    const { user, course } = seedBaseData(testDb);
    testDb.update(schema.courses).set({ price: 7900 }).run();
    // Paid less than the List Price, from a country with no PPP discount.
    testDb
      .insert(schema.purchases)
      .values({
        userId: user.id,
        courseId: course.id,
        amountPaid: 4000,
        country: "US",
      })
      .run();
    currentUserId = user.id;

    await raiseRefundRequest(course.slug);

    const email = logged.join("\n");
    expect(email).toContain("$40.00");
    expect(email).not.toContain("$79.00");
  });

  it("records an open Refund Request and emails the Student about it", async () => {
    const { user, course } = seedBaseData(testDb);
    testDb
      .insert(schema.purchases)
      .values({ userId: user.id, courseId: course.id, amountPaid: 2500 })
      .run();
    currentUserId = user.id;

    await raiseRefundRequest(course.slug);

    const requests = testDb.select().from(schema.refundRequests).all();
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe(schema.RefundRequestStatus.Requested);

    const email = logged.join("\n");
    expect(email).toContain(`Refund requested — ${course.title}`);
    expect(email).not.toMatch(/reversal|chargeback/i);
  });
});
