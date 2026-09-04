-- Feeding is a daily habit, not a care plan.
--
-- The standard-events catalog (0005) made `feed` a schedulable standard plan,
-- so the tank page recommended one and the coach could create one. But the
-- feeding counter writes `feed_logs` only -- it never touches
-- `schedules.last_done_at` -- so such a plan can never be ticked off: it sits
-- in the care queue forever, its backlog grows by a day every day no matter
-- how often you feed, it emits ICS events the PRD rules out, and it breaks the
-- care streak (which judges plans by `maintenance_logs`, where feeding never
-- appears).
--
-- `feed` is now non-schedulable in the catalog (action-types.ts), so no new one
-- can be created. This retires the ones already out there. DEACTIVATE, not
-- DELETE: the rows stay for history and for `maintenance_logs.schedule_id`
-- back-references, they just leave dashboard, calendar, ICS and streak (all of
-- which read through `listSchedules()`, active only).
UPDATE `schedules`
SET `active` = 0,
    `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE `action_type` = 'feed' AND `active` = 1;
