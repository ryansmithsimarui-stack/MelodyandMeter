# Multi-Resource Booking Migration Guidance

Version: 0.1 (2025-11-21)
Status: Draft – safe automated backfill procedure

## Goal
Add `resource_id` to all existing booking records created prior to multi-resource rollout so new availability logic (resource-scoped interval overlap) behaves consistently. Legacy bookings lack a `resource_id` field and should default to `"primary"`.

## When to Run
Run once immediately before deploying code that depends on `resource_id` for availability or analytics segmentation. Safe to re-run (idempotent) – records already having a non-empty `resource_id` are skipped.

## Data Store Context
File-based persistence located at `design/backend/node-express-stripe/data.json` (or overridden by `DB_JSON_PATH`). Bookings are stored under the `bookings` object keyed by booking id.

Booking shape after upgrade:
```jsonc
{
  "id": "b_123",
  "user_id": "u_9",
  "slot_id": "slot_A",
  "resource_id": "primary", // <- backfilled when missing
  "status": "confirmed" | "reschedule_pending" | "cancelled",
  "start_at": 1732065600000,
  "duration_min": 30,
  "created_at": 1732061000000,
  "updated_at": 1732065600000,
  "history": [ { "ts": 1732061000000, "status": "confirmed" } ],
  "pending_new_slot_id": null
}
```

## Migration Strategy Overview
1. Detect bookings missing `resource_id`.
2. Backfill with `"primary"` (business default representing the original single shared resource/teacher context).
3. Persist file.
4. Emit optional audit entries for traceability.
5. Verify counts and run full test suite.

No relational constraints exist (file-based store), so no foreign key checks are required.

## Script (One-Off Node.js)
Create `scripts/backfill-resource-id.js`:
```javascript
#!/usr/bin/env node
/* Backfill resource_id for legacy bookings */
const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.DB_JSON_PATH || path.join(__dirname, '..', 'design', 'backend', 'node-express-stripe', 'data.json');
if(!fs.existsSync(DATA_FILE)){
  console.error('Data file not found:', DATA_FILE);
  process.exit(1);
}
const raw = fs.readFileSync(DATA_FILE,'utf8');
const data = JSON.parse(raw);
const bookings = data.bookings || {};
let updated = 0;
for(const [id, b] of Object.entries(bookings)){
  if(!('resource_id' in b) || !b.resource_id){
    b.resource_id = 'primary';
    b.updated_at = Date.now();
    if(Array.isArray(b.history)){
      b.history.push({ ts: Date.now(), status: b.status, note: 'backfill_resource_id' });
    }
    updated++;
  }
}
if(updated>0){
  data.bookings = bookings;
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
console.log(`resource_id backfill complete. Updated ${updated} bookings.`);
```

Run:
```powershell
node scripts/backfill-resource-id.js
```

## Verification Steps
1. Grep for missing field:
   ```powershell
   Select-String -Path design\backend\node-express-stripe\data.json -Pattern '"resource_id"' | Measure-Object
   ```
2. (Optional) Count bookings:
   ```powershell
   node -e "const d=require('./design/backend/node-express-stripe/data.json');console.log(Object.keys(d.bookings).length)";
   ```
3. Run test suite:
   ```powershell
   node run-tests.js
   ```

## Rollback
If unintended: restore previous `data.json` from backup (recommended: copy file before running script).

## Edge Cases
- Bookings already cancelled: retain status; still backfill `resource_id`.
- Bookings missing `duration_min`: leave as-is; backfill only `resource_id`.
- Concurrent writes: Avoid running during active production traffic (file write not atomic across processes).

## Post-Migration Actions
- Update monitoring dashboards to segment bookings by `resource_id`.
- Begin collecting analytics with `resource_id` (already included in booking_confirmed & cancellation events).
- Plan future schema validation restricting allowed `resource_id` values (see validation task).

## Future Hardening
- Replace ad-hoc script with an internal admin endpoint requiring auth key.
- Store migration run metadata (timestamp, updated count) in an audit record.
- Enforce `resource_id` presence at booking creation via server-side validation.

## Summary
This migration is a simple additive backfill with zero risk of changing scheduling semantics retroactively. All legacy bookings become part of the new resource-scoped availability model under the default resource `primary`.
