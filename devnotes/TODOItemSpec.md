# TODO Item Spec

* subject: string
    * The title of the task
    * Maps to `subject` in an event.

* categories: inherit
    * The cateogries (like tags)
    * Maps to `categories` in an event.

* startDatetime: date
    * UTC time to the start of the task.
    * Stores in body, set upon changing of status to `inProgress`.

* etsDateTime: date
    * UTC time to the estimated start of the task.
    * In body json; authoritative. The event's `start` is only a window anchor (see below).

* anchorStartDateTime: date | null
    * Where Arrange last placed the event's `start`.
    * In body json. Used to detect a reschedule made outside Arrange.

* anchorEndDateTime: date | null
    * Where Arrange last placed the event's `end`. Same handling as `anchorStartDateTime`.

* createdDateTime: inherit
    * UTC to the creation of the task
    * Maps to `createdDateTime` in an event.

* lastModifiedDateTime: inherit
    * UTC to last modified.
    * Maps to `lastModifiedDateTime` in an event.

* ETADateTime: date
    * UTC time to the ETA of the task.
    * In body json; authoritative. The event's `end` is only a window anchor (see below).

* finishDateTime: date
    * UTC time to the end of the task when the user set the status to finish
    * In body json.

* originalEtsDateTime: date | null
    * **Legacy.** The planned start preserved by the retired date-bump scheme.
    * Read-only migration input: used to recover `etsDateTime` for an item bumped by the old
      scheme, then cleared on the next write. Never set to a new value.

* originalEtaDateTime: date | null
    * **Legacy.** The planned end preserved by the retired date-bump scheme. Same handling as
      `originalEtsDateTime`.

* urgent: bool
    * The urgency of the task.
    * Urgent when true, not urgent when false.

* important: bool
    * Is an important task.
    * Important when true, not important when false.

* status: string
    * Status of the task. Possible values are: `new`, `inProgress`, `blocked`, `finished`, `cancelled`.

* checklist: string
    * An array of texts.
    * [] <- not checked.
    * [x] <- checked.

* remarks: remarkObject
    * The remark area.

* remarkObject:
    {
        "type": "text" (text | markdown)
        "content": "string"
    }

## Window-Anchor Behavior

TODO items are stored as calendar events and fetched using a ±30-day time window.
To prevent non-terminal items (`new`, `inProgress`, `blocked`) from falling off the window, the
event's `start`/`end` is treated as a **window anchor** rather than as the task's dates:

* The task's planned `etsDateTime`/`etaDateTime` live in the body JSON and are never modified by
  this mechanism.
* `anchorStartDateTime`/`anchorEndDateTime` record where Arrange last put the event. If the event
  has since moved — compared with a minute's tolerance, since the calendar rounds what it stores —
  it was rescheduled outside Arrange (in Outlook, say) and those dates become the task's ETS/ETA.
  A legacy item has no recorded anchor, so an event that does not look like the old scheme's bump
  of its `originalEtsDateTime`/`originalEtaDateTime` is taken as such a reschedule instead.
* When an item's anchor is stale, it is rolled forward to today (preserving UTC time-of-day and
  duration) so the event stays inside the fetch window. This happens on edit and in the sweep that
  runs after a fetch.
* Items whose planned dates are current are anchored at those dates, so a normal item's event
  matches its plan exactly.

Terminal items (`finished`, `cancelled`) are never anchored, and are never moved back to their
planned dates either: an item finished today but planned months ago would leave the window at once
and vanish from the Finished lane. A range query also covers the anchor zone (one merged query when
the ranges overlap, otherwise two deduped queries), since the calendar matches on the anchor while
the caller means the planned dates.
Only backends that page through a window need this; the Google Sheets backend never does.
