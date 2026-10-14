import { describe, expect, it } from "vitest";
import {
  JOB_STATUS_LABELS,
  availableActions,
  describeStartProblems,
  isDeletable,
  isEditable,
  isTerminal,
  legalActions,
  parseStartProblems,
  permissionForAction,
  planJobSave,
  planTransition,
  startProblemText,
} from "./rules";
import { TRANSITION_NOTICE } from "./notice";
import { FIELD_LABELS, actorLabel, describeEvent } from "./view";
import {
  JOB_STATUSES,
  type ActivityOption,
  type JobAction,
  type JobEvent,
  type JobStatus,
} from "./types";

describe("Phase 5: State Machine & Transition Rules", () => {
  it("verifies the complete set of job statuses", () => {
    expect(JOB_STATUSES).toEqual([
      "draft",
      "queued",
      "running",
      "paused",
      "completed",
      "failed",
      "saturated",
      "stopped",
    ]);
  });

  it("verifies human-readable labels for all 8 statuses", () => {
    expect(Object.keys(JOB_STATUS_LABELS)).toHaveLength(8);
    expect(JOB_STATUS_LABELS.draft).toBe("Draft");
    expect(JOB_STATUS_LABELS.queued).toBe("Queued");
    expect(JOB_STATUS_LABELS.running).toBe("Running");
    expect(JOB_STATUS_LABELS.paused).toBe("Paused");
    expect(JOB_STATUS_LABELS.completed).toBe("Completed");
    expect(JOB_STATUS_LABELS.failed).toBe("Failed");
    expect(JOB_STATUS_LABELS.saturated).toBe("Saturated");
    expect(JOB_STATUS_LABELS.stopped).toBe("Stopped");
  });

  describe("terminalness", () => {
    it.each([
      ["completed", true],
      ["failed", true],
      ["stopped", true],
      ["draft", false],
      ["queued", false],
      ["running", false],
      ["paused", false],
      ["saturated", false],
    ] as const)("status %s isTerminal: %s", (status, expected) => {
      expect(isTerminal(status)).toBe(expected);
    });
  });

  describe("editability", () => {
    it.each([
      ["draft", true],
      ["queued", true],
      ["running", true],
      ["paused", true],
      ["saturated", true],
      ["completed", false],
      ["failed", false],
      ["stopped", false],
    ] as const)("status %s isEditable: %s", (status, expected) => {
      expect(isEditable(status)).toBe(expected);
    });
  });

  describe("deletability", () => {
    it.each([
      ["draft", true],
      ["paused", true],
      ["saturated", true],
      ["completed", true],
      ["failed", true],
      ["stopped", true],
      ["queued", false],
      ["running", false],
    ] as const)("status %s isDeletable: %s", (status, expected) => {
      expect(isDeletable(status)).toBe(expected);
    });
  });

  describe("legal transitions table for UI actions", () => {
    it("matches legal actions for each status exactly", () => {
      expect(legalActions("draft")).toEqual(["start"]);
      expect(legalActions("queued")).toEqual(["stop"]);
      expect(legalActions("running")).toEqual(["pause", "stop"]);
      expect(legalActions("paused")).toEqual(["resume", "stop"]);
      expect(legalActions("saturated")).toEqual(["resume", "stop"]);
      expect(legalActions("completed")).toEqual([]);
      expect(legalActions("failed")).toEqual([]);
      expect(legalActions("stopped")).toEqual([]);
    });
  });

  describe("permissions per action", () => {
    it("maps start to jobs.start and control actions to jobs.control", () => {
      expect(permissionForAction("start")).toBe("jobs.start");
      expect(permissionForAction("pause")).toBe("jobs.control");
      expect(permissionForAction("resume")).toBe("jobs.control");
      expect(permissionForAction("stop")).toBe("jobs.control");
    });
  });

  describe("availableActions based on user permissions", () => {
    const allPerms = ["jobs.start", "jobs.control", "jobs.view"];

    it("gives full legal actions to user with both jobs.start and jobs.control", () => {
      expect(availableActions("draft", allPerms)).toEqual(["start"]);
      expect(availableActions("running", allPerms)).toEqual(["pause", "stop"]);
      expect(availableActions("paused", allPerms)).toEqual(["resume", "stop"]);
      expect(availableActions("queued", allPerms)).toEqual(["stop"]);
      expect(availableActions("saturated", allPerms)).toEqual([
        "resume",
        "stop",
      ]);
      expect(availableActions("stopped", allPerms)).toEqual([]);
    });

    it("restricts user with only jobs.start", () => {
      const perms = ["jobs.start"];
      expect(availableActions("draft", perms)).toEqual(["start"]);
      expect(availableActions("running", perms)).toEqual([]);
      expect(availableActions("paused", perms)).toEqual([]);
      expect(availableActions("queued", perms)).toEqual([]);
      expect(availableActions("saturated", perms)).toEqual([]);
    });

    it("restricts user with only jobs.control", () => {
      const perms = ["jobs.control"];
      expect(availableActions("draft", perms)).toEqual([]);
      expect(availableActions("running", perms)).toEqual(["pause", "stop"]);
      expect(availableActions("paused", perms)).toEqual(["resume", "stop"]);
      expect(availableActions("queued", perms)).toEqual(["stop"]);
      expect(availableActions("saturated", perms)).toEqual(["resume", "stop"]);
    });

    it("returns no actions for user with only jobs.view (viewer)", () => {
      const perms = ["jobs.view"];
      for (const status of JOB_STATUSES) {
        expect(availableActions(status, perms)).toEqual([]);
      }
    });
  });

  describe("planTransition state enforcement & G3 confirmation", () => {
    it("permits legal start from draft", () => {
      expect(
        planTransition({ status: "draft", action: "start", confirm: false }),
      ).toEqual({
        ok: true,
      });
    });

    it("rejects illegal transitions with clear error", () => {
      const illegalCases: [JobStatus, JobAction][] = [
        ["draft", "pause"],
        ["draft", "resume"],
        ["draft", "stop"],
        ["queued", "start"],
        ["queued", "pause"],
        ["queued", "resume"],
        ["running", "start"],
        ["running", "resume"],
        ["paused", "start"],
        ["paused", "pause"],
        ["completed", "start"],
        ["completed", "pause"],
        ["completed", "resume"],
        ["completed", "stop"],
        ["failed", "start"],
        ["failed", "stop"],
        ["stopped", "start"],
        ["stopped", "resume"],
      ];

      for (const [status, action] of illegalCases) {
        const res = planTransition({ status, action, confirm: false });
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error).toBe(
            `That action is not available while the job is ${JOB_STATUS_LABELS[status].toLowerCase()}.`,
          );
        }
      }
    });

    it("requires confirmation when resuming saturated job (G3)", () => {
      const unconfirmed = planTransition({
        status: "saturated",
        action: "resume",
        confirm: false,
      });
      expect(unconfirmed).toEqual({
        ok: false,
        error:
          "This job stopped finding new domains. Confirm that you want to resume it.",
      });

      const confirmed = planTransition({
        status: "saturated",
        action: "resume",
        confirm: true,
      });
      expect(confirmed).toEqual({ ok: true });
    });

    it("does not require confirmation when resuming paused job", () => {
      expect(
        planTransition({ status: "paused", action: "resume", confirm: false }),
      ).toEqual({ ok: true });
    });
  });

  describe("TRANSITION_NOTICE messages", () => {
    it("provides concise and clear notice messages for each action", () => {
      expect(TRANSITION_NOTICE.start).toBe(
        "Job started. It is queued until a worker picks it up.",
      );
      expect(TRANSITION_NOTICE.pause).toBe("Job paused.");
      expect(TRANSITION_NOTICE.resume).toBe("Job resumed.");
      expect(TRANSITION_NOTICE.stop).toBe(
        "Job stopped. A stopped job cannot be restarted.",
      );
    });
  });
});

describe("Phase 5: Start Pre-condition Validations", () => {
  it("translates all known problem codes", () => {
    expect(startProblemText("missing_client_domain")).toBe(
      "Add the client's domain.",
    );
    expect(startProblemText("missing_business_type")).toBe(
      "Add the business type.",
    );
    expect(startProblemText("missing_country")).toBe("Choose a country.");
    expect(startProblemText("missing_language")).toBe("Choose a language.");
    expect(startProblemText("missing_seed_keywords")).toBe(
      "Add at least one seed keyword.",
    );
    expect(startProblemText("no_activity")).toBe(
      "Choose at least one activity.",
    );
    expect(startProblemText("activity_unknown")).toBe(
      "One of the selected activities no longer exists.",
    );
    expect(startProblemText("activity_disabled")).toBe(
      "One of the selected activities is disabled.",
    );
    expect(startProblemText("no_source")).toBe(
      "Add a source: a Serper credit budget above 0, seed list URLs or competitor domains.",
    );
  });

  it("falls back to the raw code if unknown", () => {
    expect(startProblemText("custom_future_code")).toBe("custom_future_code");
  });

  it("parses single problem code from database error", () => {
    expect(parseStartProblems("P0001: job_not_ready:no_source")).toEqual([
      "no_source",
    ]);
  });

  it("parses multiple comma-separated problem codes from database error", () => {
    const errorMsg =
      "P0001: job_not_ready:missing_client_domain,missing_country,no_activity (CONTEXT: PL/pgSQL function)";
    expect(parseStartProblems(errorMsg)).toEqual([
      "missing_client_domain",
      "missing_country",
      "no_activity",
    ]);
  });

  it("returns empty array when error message has no job_not_ready prefix", () => {
    expect(
      parseStartProblems("invalid_transition: start from running"),
    ).toEqual([]);
    expect(parseStartProblems("permission denied")).toEqual([]);
    expect(parseStartProblems("")).toEqual([]);
  });

  it("describes start problems into a comprehensive human sentence", () => {
    const desc = describeStartProblems(["missing_client_domain", "no_source"]);
    expect(desc).toBe(
      "This job cannot start yet. Add the client's domain. Add a source: a Serper credit budget above 0, seed list URLs or competitor domains.",
    );
  });

  it("describes empty start problems cleanly", () => {
    expect(describeStartProblems([])).toBe("This job cannot start yet.");
  });
});

describe("Phase 5: Plan Job Save & Activity Validation", () => {
  const activities: ActivityOption[] = [
    { key: "guest_posting", name: "Guest Posting", enabled: true },
    { key: "niche_edits", name: "Niche Edits", enabled: false },
  ];

  it("accepts save when all activity keys exist and are enabled", () => {
    expect(
      planJobSave({
        previousActivityKeys: null,
        activityKeys: ["guest_posting"],
        activities,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects non-existent activity keys", () => {
    expect(
      planJobSave({
        previousActivityKeys: null,
        activityKeys: ["ghost_activity"],
        activities,
      }),
    ).toEqual({
      ok: false,
      error:
        "One of the selected activities no longer exists. Reload the page and try again.",
    });
  });

  it("rejects newly selected disabled activity", () => {
    expect(
      planJobSave({
        previousActivityKeys: ["guest_posting"],
        activityKeys: ["guest_posting", "niche_edits"],
        activities,
      }),
    ).toEqual({
      ok: false,
      error:
        "The “Niche Edits” activity is disabled. Ask an admin to enable it.",
    });
  });

  it("permits keeping an activity that was already enabled on the job when it was disabled later", () => {
    expect(
      planJobSave({
        previousActivityKeys: ["niche_edits"],
        activityKeys: ["niche_edits"],
        activities,
      }),
    ).toEqual({ ok: true });
  });
});

describe("Phase 5: Audit Trail & Activity Log Presentation", () => {
  it("formats created event", () => {
    expect(
      describeEvent({
        type: "created",
        payload: { name: "Test Job" },
        config_version: 1,
      }),
    ).toBe("Created the job.");
  });

  it("formats edited draft event with field list", () => {
    expect(
      describeEvent({
        type: "edited",
        payload: { fields: ["client", "business_type"] },
        config_version: 1,
      }),
    ).toBe("Edited client, business type.");
  });

  it("formats config_changed event with version and fields", () => {
    expect(
      describeEvent({
        type: "config_changed",
        payload: {
          fields: ["budget_credits", "seed_keywords"],
          from_version: 1,
        },
        config_version: 2,
      }),
    ).toBe("Changed credit budget, seed keywords. Settings are now version 2.");
  });

  it("formats config_changed event with more than 5 fields", () => {
    expect(
      describeEvent({
        type: "config_changed",
        payload: {
          fields: [
            "name",
            "client",
            "business_type",
            "country",
            "language",
            "seed_keywords",
            "budget_credits",
          ],
        },
        config_version: 3,
      }),
    ).toBe(
      "Changed job name, client, business type, country, language and 2 more. Settings are now version 3.",
    );
  });

  it("formats status_changed start event", () => {
    expect(
      describeEvent({
        type: "status_changed",
        payload: { action: "start", from: "draft", to: "queued" },
        config_version: 1,
      }),
    ).toBe("Started the job. It is queued for a worker.");
  });

  it("formats status_changed pick_up event", () => {
    expect(
      describeEvent({
        type: "status_changed",
        payload: { action: "pick_up", from: "queued", to: "running" },
        config_version: 1,
      }),
    ).toBe("Picked up the job.");
  });

  it("formats status_changed pause event", () => {
    expect(
      describeEvent({
        type: "status_changed",
        payload: { action: "pause", from: "running", to: "paused" },
        config_version: 1,
      }),
    ).toBe("Paused the job.");
  });

  it("formats status_changed resume event", () => {
    expect(
      describeEvent({
        type: "status_changed",
        payload: { action: "resume", from: "paused", to: "running" },
        config_version: 1,
      }),
    ).toBe("Resumed the job.");
  });

  it("formats status_changed stop event with reason", () => {
    expect(
      describeEvent({
        type: "status_changed",
        payload: {
          action: "stop",
          from: "running",
          to: "stopped",
          reason: "Target reached",
        },
        config_version: 1,
      }),
    ).toBe("Stopped the job: Target reached");
  });

  it("formats status_changed stop event without reason", () => {
    expect(
      describeEvent({
        type: "status_changed",
        payload: { action: "stop", from: "running", to: "stopped" },
        config_version: 1,
      }),
    ).toBe("Stopped the job.");
  });

  it("formats status_changed complete event", () => {
    expect(
      describeEvent({
        type: "status_changed",
        payload: { action: "complete", from: "running", to: "completed" },
        config_version: 1,
      }),
    ).toBe("Finished every query. The job is completed.");
  });

  it("formats status_changed saturate event", () => {
    expect(
      describeEvent({
        type: "status_changed",
        payload: { action: "saturate", from: "running", to: "saturated" },
        config_version: 1,
      }),
    ).toBe(
      "Paused the job automatically: the latest queries found too few new domains.",
    );
  });

  it("formats status_changed fail event with and without reason", () => {
    expect(
      describeEvent({
        type: "status_changed",
        payload: {
          action: "fail",
          from: "running",
          to: "failed",
          reason: "Proxy timeout",
        },
        config_version: 1,
      }),
    ).toBe("The job failed: Proxy timeout");

    expect(
      describeEvent({
        type: "status_changed",
        payload: { action: "fail", from: "running", to: "failed" },
        config_version: 1,
      }),
    ).toBe("The job failed.");
  });

  it("formats status_changed fallback when action is unknown but from/to exist", () => {
    expect(
      describeEvent({
        type: "status_changed",
        payload: { from: "running", to: "paused" },
        config_version: 1,
      }),
    ).toBe("Changed status from Running to Paused.");
  });

  it("formats unknown event type gracefully", () => {
    expect(
      describeEvent({
        type: "rescored_batch" as unknown as JobEvent["type"],
        payload: {},
        config_version: 1,
      }),
    ).toBe("Rescored batch.");
  });

  it("resolves actor label for user with name, user with id only, and system/worker", () => {
    expect(actorLabel({ actor_name: "Alice", actor_id: "123" })).toBe("Alice");
    expect(actorLabel({ actor_name: null, actor_id: "123" })).toBe(
      "A team member",
    );
    expect(actorLabel({ actor_name: null, actor_id: null })).toBe("System");
  });

  it("maps all major database columns to human-readable field labels", () => {
    expect(FIELD_LABELS.client_domain).toBe("client domain");
    expect(FIELD_LABELS.budget_credits).toBe("credit budget");
    expect(FIELD_LABELS.saturation_n).toBe("saturation window");
    expect(FIELD_LABELS.saturation_x).toBe("saturation minimum");
    expect(FIELD_LABELS.per_domain_cap).toBe("per-domain cap");
  });
});
