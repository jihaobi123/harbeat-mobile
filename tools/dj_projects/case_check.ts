import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  canonicalCase,
  validateReferenceCase,
} from "../../vendor/realtime-v3/src/mobile/dj-reference/contract";

const value = JSON.parse(fs.readFileSync(0, "utf8"));
value.id = createHash("sha256")
  .update(canonicalCase(value), "utf8")
  .digest("hex");
if (value.approved) validateReferenceCase(value);
process.stdout.write(JSON.stringify(value));
