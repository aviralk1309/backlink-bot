import { describe, expect, it } from "vitest";
import {
  confirmUploadSchema,
  deleteUploadSchema,
  discardUploadSchema,
  registerUploadSchema,
  saveMappingSchema,
} from "./schemas";

const VALID_JOB_ID = "11111111-1111-4111-a111-111111111111";
const VALID_UPLOAD_ID = "22222222-2222-4222-a222-222222222222";

describe("confirmUploadSchema", () => {
  it("validates uuid fields", () => {
    const valid = {
      job_id: VALID_JOB_ID,
      upload_id: VALID_UPLOAD_ID,
    };
    expect(confirmUploadSchema.safeParse(valid).success).toBe(true);

    const invalid = {
      job_id: "not-a-uuid",
      upload_id: VALID_UPLOAD_ID,
    };
    expect(confirmUploadSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("discardUploadSchema", () => {
  it("validates uuid fields", () => {
    const valid = {
      job_id: VALID_JOB_ID,
      upload_id: VALID_UPLOAD_ID,
    };
    expect(discardUploadSchema.safeParse(valid).success).toBe(true);
  });
});

describe("registerUploadSchema", () => {
  it("accepts competitor and client uploads", () => {
    const competitor = {
      job_id: VALID_JOB_ID,
      upload_id: VALID_UPLOAD_ID,
      kind: "competitor",
      competitor: "rival.com",
      filename: "export.csv",
    };
    expect(registerUploadSchema.safeParse(competitor).success).toBe(true);

    const client = {
      job_id: VALID_JOB_ID,
      upload_id: VALID_UPLOAD_ID,
      kind: "client",
      competitor: "",
      filename: "client.csv",
    };
    expect(registerUploadSchema.safeParse(client).success).toBe(true);
  });
});

describe("saveMappingSchema", () => {
  it("requires template_name when save_as_template is true", () => {
    const base = {
      job_id: VALID_JOB_ID,
      upload_id: VALID_UPLOAD_ID,
      url_index: 0,
      url_column: "Target URL",
      columns: [],
    };

    expect(
      saveMappingSchema.safeParse({
        ...base,
        save_as_template: true,
        template_name: "",
      }).success,
    ).toBe(false);

    expect(
      saveMappingSchema.safeParse({
        ...base,
        save_as_template: true,
        template_name: "My Template",
      }).success,
    ).toBe(true);
  });
});

describe("deleteUploadSchema", () => {
  it("validates uuid fields", () => {
    const valid = {
      job_id: VALID_JOB_ID,
      upload_id: VALID_UPLOAD_ID,
    };
    expect(deleteUploadSchema.safeParse(valid).success).toBe(true);

    const invalid = {
      job_id: "not-a-uuid",
      upload_id: VALID_UPLOAD_ID,
    };
    expect(deleteUploadSchema.safeParse(invalid).success).toBe(false);
  });
});
