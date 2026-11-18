import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MAX_CSV_BYTES } from "./limits";

it("O-13 local Storage permits the UI CSV limit", () => {
  const config = readFileSync(
    new URL("../../../../../supabase/config.toml", import.meta.url),
    "utf8",
  );
  const storage = config.split("[storage]\n")[1]?.split("\n[")[0];
  const limitMiB = storage?.match(/^file_size_limit = "(\d+)MiB"$/m)?.[1];
  expect(Number(limitMiB) * 1024 * 1024).toBeGreaterThanOrEqual(MAX_CSV_BYTES);
});
